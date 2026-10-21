/**
 * Metadata fetcher.
 *
 * IMPORTANT: Uses Obsidian's native `requestUrl()` – never the browser
 * `fetch()` – so that requests work on iOS/Android without CORS blocks.
 */
import { requestUrl } from "obsidian";
import type { LinkMetadata } from "./types";

export interface HtmlMetadata {
	title?: string;
	description?: string;
	faviconUrl?: string;
}

export type FetchResult =
	| { ok: true; metadata: LinkMetadata }
	| { ok: false; status?: number; error: string };

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 300;

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
	ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’",
	ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•", middot: "·",
	copy: "©", reg: "®", trade: "™", euro: "€",
	auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
	eacute: "é", egrave: "è", aacute: "á", agrave: "à",
};

export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
		if (entity[0] === "#") {
			const code = entity[1] === "x" || entity[1] === "X"
				? parseInt(entity.slice(2), 16)
				: parseInt(entity.slice(1), 10);
			try {
				return Number.isFinite(code) ? String.fromCodePoint(code) : match;
			} catch {
				return match;
			}
		}
		return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match;
	});
}

function clean(value: string | undefined, maxLength: number): string | undefined {
	if (!value) return undefined;
	const text = decodeHtmlEntities(value.replace(/<[^>]*>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return undefined;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/** Parses the attributes of a single HTML tag into a lower-cased map. */
export function parseAttributes(tag: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const pattern = /([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(tag))) {
		attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
	}
	return attributes;
}

function resolveUrl(href: string, baseUrl: string): string | undefined {
	try {
		const resolved = new URL(decodeHtmlEntities(href.trim()), baseUrl);
		return /^https?:$/.test(resolved.protocol) || resolved.protocol === "data:" ? resolved.href : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Extracts OpenGraph / HTML metadata from raw HTML without a DOM, so it works
 * identically in Obsidian (desktop + mobile) and in unit tests.
 */
export function parseHtmlMetadata(html: string, baseUrl: string): HtmlMetadata {
	const headEnd = html.search(/<\/head\s*>/i);
	const head = headEnd === -1 ? html.slice(0, 500_000) : html.slice(0, headEnd);

	const meta: Record<string, string> = {};
	for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
		const attrs = parseAttributes(tag);
		const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase();
		if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
	}

	const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];

	let icon: string | undefined;
	let appleIcon: string | undefined;
	for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
		const attrs = parseAttributes(tag);
		const rel = attrs.rel?.toLowerCase().split(/\s+/) ?? [];
		if (!attrs.href) continue;
		if (!icon && rel.includes("icon")) icon = attrs.href;
		else if (!appleIcon && (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed"))) {
			appleIcon = attrs.href;
		}
	}

	const result: HtmlMetadata = {};
	const title = clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, MAX_TITLE_LENGTH);
	const description = clean(
		meta["og:description"] ?? meta["description"] ?? meta["twitter:description"],
		MAX_DESCRIPTION_LENGTH,
	);
	const faviconHref = icon ?? appleIcon;
	const faviconUrl = faviconHref ? resolveUrl(faviconHref, baseUrl) : undefined;

	if (title) result.title = title;
	if (description) result.description = description;
	if (faviconUrl) result.faviconUrl = faviconUrl;
	return result;
}

function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) return value;
	}
	return undefined;
}

/** Fetches and parses metadata for a URL via `requestUrl()`. Never throws. */
export async function fetchLinkMetadata(url: string, now: number = Date.now()): Promise<FetchResult> {
	try {
		const response = await requestUrl({
			url,
			method: "GET",
			throw: false,
			headers: {
				Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
				"User-Agent": "Mozilla/5.0 (compatible; ObsidianSmartLinkCards/1.0; +https://obsidian.md)",
			},
		});

		if (response.status < 200 || response.status >= 400) {
			return { ok: false, status: response.status, error: `HTTP ${response.status}` };
		}

		const contentType = getHeader(response.headers, "content-type");
		if (contentType && !/html|xml/i.test(contentType)) {
			// Non-HTML resource (PDF, image, …): cache an empty entry so it is not refetched.
			return { ok: true, metadata: { fetchedAt: now } };
		}

		const html = typeof response.text === "string" ? response.text : "";
		return { ok: true, metadata: { ...parseHtmlMetadata(html, url), fetchedAt: now } };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
