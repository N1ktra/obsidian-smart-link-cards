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
	imageUrl?: string;
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
 * Extracts image from JSON-LD scripts (Schema.org, Yoast, RankMath, Product, Article, CollectionPage).
 */
export function extractJsonLdImage(html: string, baseUrl: string): string | undefined {
	const jsonLdScripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
	for (const scriptTag of jsonLdScripts) {
		const raw = scriptTag.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
		try {
			const data = JSON.parse(raw);
			const findImage = (obj: unknown): string | null => {
				if (!obj || typeof obj !== "object") return null;
				const record = obj as Record<string, unknown>;
				if (typeof record.thumbnailUrl === "string" && record.thumbnailUrl.trim()) {
					return record.thumbnailUrl;
				}
				if (typeof record.image === "string" && record.image.trim()) {
					return record.image;
				}
				if (Array.isArray(record.image)) {
					for (const item of record.image) {
						if (typeof item === "string" && item.trim()) return item;
						if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
							return (item as Record<string, unknown>).url as string;
						}
					}
				}
				if (record.image && typeof record.image === "object") {
					const imgObj = record.image as Record<string, unknown>;
					if (typeof imgObj.url === "string" && imgObj.url.trim()) return imgObj.url;
					if (typeof imgObj.contentUrl === "string" && imgObj.contentUrl.trim()) return imgObj.contentUrl;
				}
				if (record["@type"] === "ImageObject") {
					if (typeof record.contentUrl === "string" && record.contentUrl.trim()) return record.contentUrl;
					if (typeof record.url === "string" && record.url.trim()) return record.url;
				}
				if (Array.isArray(record["@graph"])) {
					for (const item of record["@graph"]) {
						const found = findImage(item);
						if (found) return found;
					}
				}
				return null;
			};
			const found = findImage(data);
			if (found) {
				const resolved = resolveUrl(found, baseUrl);
				if (resolved) return resolved;
			}
		} catch {
			// Skip malformed JSON-LD scripts
		}
	}
	return undefined;
}

/**
 * Extracts fallback product or content images (e.g. Amazon product images,
 * WordPress featured images, schema.org microdata, or JSON-LD) that often live outside <head>.
 */
export function extractFallbackImage(html: string, baseUrl: string): string | undefined {
	const isAmazon = /amazon\.[a-z.]+/i.test(baseUrl);

	if (isAmazon) {
		// 1. Amazon landing image tag: <img id="landingImage" ...> or imgBlkFront or main-image
		const amazonImgMatch = /<img\b[^>]*\bid=["'](?:landingImage|imgBlkFront|main-image)["'][^>]*>/i.exec(html);
		if (amazonImgMatch) {
			const tag = amazonImgMatch[0];
			const oldHires = /data-old-hires=["']([^"']+)["']/i.exec(tag)?.[1];
			if (oldHires && oldHires.trim()) {
				const resolved = resolveUrl(oldHires, baseUrl);
				if (resolved) return resolved;
			}
			const dynamic = /data-a-dynamic-image=["']([^"']+)["']/i.exec(tag)?.[1];
			if (dynamic) {
				const dynamicMatch = /(https:\/\/[^"'\s]+media-amazon\.com\/images\/I\/[^"'\s]+\.(?:jpg|png|webp))/i.exec(dynamic);
				if (dynamicMatch) {
					const resolved = resolveUrl(dynamicMatch[1], baseUrl);
					if (resolved) return resolved;
				}
			}
			const src = /src=["']([^"']+)["']/i.exec(tag)?.[1];
			if (src && !src.startsWith("data:")) {
				const resolved = resolveUrl(src, baseUrl);
				if (resolved) return resolved;
			}
		}

		// 2. High-resolution gallery data in script blocks
		const hiResMatch = /["']hiRes["']\s*:\s*["']([^"']+)["']/i.exec(html);
		if (hiResMatch) {
			const resolved = resolveUrl(hiResMatch[1], baseUrl);
			if (resolved) return resolved;
		}

		const largeMatch = /["']large["']\s*:\s*["'](https:\/\/[^"'\s]+media-amazon\.com\/images\/I\/[^"'\s]+\.(?:jpg|png|webp))["']/i.exec(html);
		if (largeMatch) {
			const resolved = resolveUrl(largeMatch[1], baseUrl);
			if (resolved) return resolved;
		}

		// 3. Fallback: first prominent product image in media-amazon
		const mediaAmazonMatch = /(https:\/\/(?:m|images-na|images-eu)\.media-amazon\.com\/images\/I\/[a-zA-Z0-9%+_.-]+\.(?:jpg|png|webp))/i.exec(html);
		if (mediaAmazonMatch) {
			return mediaAmazonMatch[1];
		}
	}

	// 1. JSON-LD schema (Yoast SEO, RankMath, WooCommerce, Shopify, etc.)
	const jsonLdImg = extractJsonLdImage(html, baseUrl);
	if (jsonLdImg) return jsonLdImg;

	// 2. General fallback: meta tags outside <head>
	const bodyMetaMatch = /<meta\b[^>]*(?:property|name|itemprop)=["'](?:og:image|twitter:image|image)["'][^>]*content=["']([^"']+)["']/i.exec(html);
	if (bodyMetaMatch) {
		const resolved = resolveUrl(bodyMetaMatch[1], baseUrl);
		if (resolved) return resolved;
	}

	// 3. WordPress / CMS featured image (wp-post-image, attachment-post-thumbnail, etc.)
	const wpImgMatch = /<img\b[^>]*\bclass=["'][^"']*(?:wp-post-image|attachment-post-thumbnail|attachment-woocommerce_thumbnail|featured-image|entry-thumb)[^"']*["'][^>]*>/i.exec(html);
	if (wpImgMatch) {
		const tag = wpImgMatch[0];
		const src = /src=["']([^"']+)["']/i.exec(tag)?.[1] ?? /data-src=["']([^"']+)["']/i.exec(tag)?.[1];
		if (src && !src.startsWith("data:")) {
			const resolved = resolveUrl(src, baseUrl);
			if (resolved) return resolved;
		}
	}

	// 4. Schema.org microdata: <img itemprop="image" ...>
	const itempropImg = /<img\b[^>]*\bitemprop=["']image["'][^>]*src=["']([^"']+)["']/i.exec(html);
	if (itempropImg) {
		const resolved = resolveUrl(itempropImg[1], baseUrl);
		if (resolved) return resolved;
	}

	// 5. High-resolution tile image (msapplication-TileImage)
	const tileMatch =
		/<meta\b[^>]*name=["']msapplication-TileImage["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
		/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']msapplication-TileImage["']/i.exec(html);
	if (tileMatch && tileMatch[1]) {
		const resolved = resolveUrl(tileMatch[1], baseUrl);
		if (resolved) return resolved;
	}

	// 6. Direct YouTube URL or embedded showcase video / poster
	const ytDirect = /(?:youtube\.com\/(?:watch\?.*v=|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.exec(baseUrl);
	if (ytDirect && ytDirect[1]) {
		return `https://img.youtube.com/vi/${ytDirect[1]}/hqdefault.jpg`;
	}

	const clean = html.replace(/<!--[\s\S]*?-->/g, "");

	// Embedded YouTube iframe (extremely common on project showcases, devlogs, research papers, Kickstarter)
	const ytEmbed =
		/<iframe\b[^>]*\bsrc=["'][^"']*(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})[^"']*["']/i.exec(
			clean,
		);
	if (ytEmbed && ytEmbed[1]) {
		return `https://img.youtube.com/vi/${ytEmbed[1]}/hqdefault.jpg`;
	}

	// HTML5 video poster
	const posterMatch = /<video\b[^>]*\bposter=["']([^"']+)["']/i.exec(clean);
	if (posterMatch && posterMatch[1]) {
		const resolved = resolveUrl(posterMatch[1], baseUrl);
		if (resolved) return resolved;
	}

	// 7. First prominent content image (excluding SVGs, tracking pixels, UI icons, avatars)
	const containerMatch =
		/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i.exec(clean) ??
		/<div\b[^>]*(?:class|id)=["'][^"']*(?:content|post-body|entry-content|article|main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
			clean,
		);
	const searchArea =
		containerMatch ? containerMatch[1] : (/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(clean)?.[1] ?? clean);

	const imgRegex = /<img\b([^>]*)>/gi;
	let match;
	while ((match = imgRegex.exec(searchArea)) !== null) {
		const attrs = match[1];
		const srcMatch = /\b(?:src|data-src)=["']([^"']+)["']/i.exec(attrs);
		if (!srcMatch || !srcMatch[1]) continue;
		const src = srcMatch[1].trim();

		// Skip data URIs (inline base64/placeholders)
		if (src.startsWith("data:")) continue;

		// Skip SVG icons/logos
		if (/\.svg($|\?)/i.test(src)) continue;

		// Skip tracking pixels, tiny spacers, or UI icons/avatars
		if (/spacer|pixel|tracking|beacon|1x1/i.test(src)) continue;
		if (
			/\b(?:avatar|favicon|icon|emoji|badge|spinner|loader)\b/i.test(attrs) ||
			/\b(?:avatar|favicon|icon|emoji|badge)\b/i.test(src)
		) {
			continue;
		}

		// Skip tiny images (< 60px)
		const wMatch = /\bwidth=["']?(\d+)/i.exec(attrs);
		const hMatch = /\bheight=["']?(\d+)/i.exec(attrs);
		if (wMatch && parseInt(wMatch[1], 10) < 60) continue;
		if (hMatch && parseInt(hMatch[1], 10) < 60) continue;

		const resolved = resolveUrl(src, baseUrl);
		if (resolved) return resolved;
	}

	return undefined;
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
	let linkImage: string | undefined;
	for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
		const attrs = parseAttributes(tag);
		const rel = attrs.rel?.toLowerCase().split(/\s+/) ?? [];
		if (!attrs.href) continue;
		if (!icon && rel.includes("icon")) icon = attrs.href;
		else if (!appleIcon && (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed"))) {
			appleIcon = attrs.href;
		} else if (!linkImage && rel.includes("image_src")) {
			linkImage = attrs.href;
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

	const rawImage =
		meta["og:image"] ??
		meta["og:image:url"] ??
		meta["og:image:secure_url"] ??
		meta["twitter:image"] ??
		meta["twitter:image:src"] ??
		meta["thumbnail"] ??
		linkImage;
	let imageUrl = rawImage ? resolveUrl(rawImage, baseUrl) : undefined;
	if (!imageUrl) {
		imageUrl = extractFallbackImage(html, baseUrl);
	}

	if (title) result.title = title;
	if (description) result.description = description;
	if (faviconUrl) result.faviconUrl = faviconUrl;
	if (imageUrl) result.imageUrl = imageUrl;
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

function selectUserAgent(url: string): string {
	if (/reddit\.com|twitter\.com|x\.com/i.test(url)) {
		return "Twitterbot/1.0";
	}
	return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
}

/** Fetches and parses metadata for a URL via `requestUrl()`. Never throws. */
export async function fetchLinkMetadata(url: string, now: number = Date.now()): Promise<FetchResult> {
	try {
		const response = await requestUrl({
			url,
			method: "GET",
			throw: false,
			headers: {
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
				"Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
				"User-Agent": selectUserAgent(url),
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
