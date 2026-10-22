/**
 * Pure, dependency-free Markdown link parser.
 *
 * The parser never modifies Markdown – it only *locates* web links so that the
 * renderers can decorate them visually.
 */
import type {
	DisplayMode,
	DocumentLink,
	LinkOverrides,
	ManualIcon,
	ParsedLink,
} from "./types";

const WEB_URL = /^https?:\/\/\S/i;
const BARE_URL = /^https?:\/\/[^\s<>`"]+/i;
const AUTOLINK = /^<(https?:\/\/[^\s<>]+)>/i;
/** Characters allowed directly before a bare URL. */
const BARE_PREFIX_OK = /[\s(*_~]/;
/** Punctuation that is stripped from the end of bare URLs. */
const TRAILING_PUNCTUATION = /[.,;:!?'"*_~]$/;
/** Maximum length (in code points) for a non-URL manual icon (emoji). */
const MAX_EMOJI_LENGTH = 8;
const IMAGE_EXT = /\.(png|jpe?g|svg|gif|webp|ico|bmp|avif)$/i;

/** Returns `true` for absolute http(s) URLs. */
export function isWebUrl(url: string | undefined | null): boolean {
	return !!url && WEB_URL.test(url.trim());
}

/** Normalises a URL so it can be used as a stable cache key. */
export function normalizeUrl(url: string): string {
	const trimmed = url.trim();
	const hash = trimmed.indexOf("#");
	return hash === -1 ? trimmed : trimmed.slice(0, hash);
}

/* ------------------------------------------------------------------------ */
/* Overrides                                                                 */
/* ------------------------------------------------------------------------ */

/** Classifies a manual icon value as image URL, vault image wikilink, or emoji. */
export function parseIcon(raw: string | undefined): ManualIcon | undefined {
	const value = raw?.trim();
	if (!value) return undefined;
	if (/^(https?:\/\/|data:image\/)/i.test(value)) return { type: "url", value };

	// Vault wikilink syntax: [[image.jpg]] or ![[image.jpg]] (optionally with alias/size like [[image.jpg|100]])
	const wikilink = /^!?\[\[([^\]]+)\]\]$/.exec(value);
	if (wikilink) {
		const target = wikilink[1].split("|")[0].trim();
		if (target) return { type: "vault", value: target };
	}

	// Plain image path in vault (e.g. "image.png" or "attachments/logo.svg")
	if (IMAGE_EXT.test(value) && !value.includes('"')) {
		return { type: "vault", value };
	}

	if (!/\s/.test(value) && Array.from(value).length <= MAX_EMOJI_LENGTH) {
		return { type: "emoji", value };
	}
	return undefined;
}

/**
 * Parses the Markdown title attribute:
 * `"Manual description | OptionalIcon"`.
 *
 * - Text before the (last) pipe → description
 * - Text after the pipe → icon (image URL, vault image wikilink, or emoji)
 * - No pipe → checks if the whole title is an icon or description
 */
export function parseTitleOverrides(
	rawTitle: string | undefined,
): Pick<LinkOverrides, "description" | "icon"> {
	const title = rawTitle?.trim();
	if (!title) return {};

	// If the entire title is a wikilink (e.g. "[[Bild.jpg]]" or "[[Bild.jpg|alias]]")
	const entireWikilink = /^!?\[\[([^\]]+)\]\]$/.exec(title);
	if (entireWikilink) {
		const target = entireWikilink[1].split("|")[0].trim();
		if (target) return { icon: { type: "vault", value: target } };
	}

	// Check if title ends with a wikilink preceded by optional pipe, e.g. "Description | [[Image.png]]"
	const wikilinkEnd = /(?:^|\s*\|\s*)(!?\[\[[^\]]+\]\])\s*$/.exec(title);
	if (wikilinkEnd) {
		const wikilinkRaw = wikilinkEnd[1];
		const icon = parseIcon(wikilinkRaw);
		if (icon) {
			const descPart = title.slice(0, wikilinkEnd.index).trim();
			const description = descPart.replace(/\s*\|\s*$/, "").trim();
			const result: Pick<LinkOverrides, "description" | "icon"> = { icon };
			if (description) result.description = description;
			return result;
		}
	}

	const pipe = title.lastIndexOf("|");
	if (pipe === -1) {
		return { description: title };
	}

	const description = title.slice(0, pipe).trim();
	const icon = parseIcon(title.slice(pipe + 1));
	if (!icon) return { description: title };

	const result: Pick<LinkOverrides, "description" | "icon"> = { icon };
	if (description) result.description = description;
	return result;
}

/** Removes the most common inline Markdown formatting markers. */
export function stripInlineMarkdown(text: string): string {
	return text
		.replace(/\\([\\`*_{}[\]()#+\-.!|~=])/g, "$1")
		.replace(/(\*\*|__|~~|==|`)/g, "")
		.replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$)/g, "$1$2")
		.trim();
}

function buildOverrides(url: string, text: string | undefined, rawTitle: string | undefined): LinkOverrides {
	const overrides: LinkOverrides = { ...parseTitleOverrides(rawTitle) };
	const title = text !== undefined ? stripInlineMarkdown(text) : "";
	if (title && title !== url) overrides.title = title;
	return overrides;
}

/* ------------------------------------------------------------------------ */
/* Line scanning                                                             */
/* ------------------------------------------------------------------------ */

/** Finds inline code spans (`` `code` ``) as `[from, to)` ranges. */
export function findInlineCodeRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let i = 0;
	while (i < line.length) {
		const c = line[i];
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c !== "`") {
			i++;
			continue;
		}
		let j = i;
		while (j < line.length && line[j] === "`") j++;
		const runLength = j - i;

		let k = j;
		let closeEnd = -1;
		while (k < line.length) {
			if (line[k] !== "`") {
				k++;
				continue;
			}
			let m = k;
			while (m < line.length && line[m] === "`") m++;
			if (m - k === runLength) {
				closeEnd = m;
				break;
			}
			k = m;
		}

		if (closeEnd === -1) {
			i = j; // unmatched backticks are literal text
		} else {
			ranges.push([i, closeEnd]);
			i = closeEnd;
		}
	}
	return ranges;
}

function findClosingBracket(line: string, open: number): number {
	let depth = 0;
	for (let i = open; i < line.length; i++) {
		const c = line[i];
		if (c === "\\") {
			i++;
			continue;
		}
		if (c === "[") depth++;
		else if (c === "]") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

interface LinkTail {
	url: string;
	title?: string;
	end: number;
}

/** Parses `(url "title")` starting at the opening parenthesis. */
function parseLinkTail(line: string, openParen: number): LinkTail | null {
	let i = openParen + 1;
	const skipSpaces = () => {
		while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
	};

	skipSpaces();
	let url: string;
	if (line[i] === "<") {
		const close = line.indexOf(">", i + 1);
		if (close === -1) return null;
		url = line.slice(i + 1, close);
		i = close + 1;
	} else {
		const start = i;
		let depth = 0;
		while (i < line.length) {
			const c = line[i];
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === " " || c === "\t") break;
			if (c === "(") depth++;
			else if (c === ")") {
				if (depth === 0) break;
				depth--;
			}
			i++;
		}
		url = line.slice(start, Math.min(i, line.length));
	}

	skipSpaces();
	let title: string | undefined;
	const quote = line[i];
	if (quote === '"' || quote === "'" || quote === "(") {
		const closeQuote = quote === "(" ? ")" : quote;
		let j = i + 1;
		let buffer = "";
		while (j < line.length && line[j] !== closeQuote) {
			if (line[j] === "\\" && j + 1 < line.length) {
				buffer += line[j + 1];
				j += 2;
				continue;
			}
			buffer += line[j];
			j++;
		}
		if (j >= line.length) return null;
		title = buffer;
		i = j + 1;
		skipSpaces();
	}

	if (line[i] !== ")") return null;
	return { url, title, end: i + 1 };
}

/** Strips trailing punctuation and unbalanced closing parentheses. */
function trimBareUrl(url: string): string {
	let result = url;
	for (;;) {
		if (TRAILING_PUNCTUATION.test(result)) {
			result = result.slice(0, -1);
			continue;
		}
		if (result.endsWith(")")) {
			const open = (result.match(/\(/g) ?? []).length;
			const close = (result.match(/\)/g) ?? []).length;
			if (close > open) {
				result = result.slice(0, -1);
				continue;
			}
		}
		return result;
	}
}

/**
 * Finds all web links in a single line of Markdown.
 *
 * Ignores inline code, images (`![](…)`), badges (`[![](…)](…)`),
 * wiki links and non-http(s) destinations.
 */
export function findLinksInLine(line: string): ParsedLink[] {
	const codeRanges = findInlineCodeRanges(line);
	const links: ParsedLink[] = [];
	let i = 0;

	while (i < line.length) {
		const code = codeRanges.find(([from, to]) => i >= from && i < to);
		if (code) {
			i = code[1];
			continue;
		}

		const c = line[i];
		if (c === "\\") {
			i += 2;
			continue;
		}

		if (c === "[") {
			// Wiki links / embeds: [[…]]
			if (line[i + 1] === "[") {
				const end = line.indexOf("]]", i + 2);
				if (end !== -1) {
					i = end + 2;
					continue;
				}
			}
			const isImage = i > 0 && line[i - 1] === "!";
			const close = findClosingBracket(line, i);
			if (close !== -1 && line[close + 1] === "(") {
				const tail = parseLinkTail(line, close + 1);
				if (tail) {
					const from = isImage ? i - 1 : i;
					const text = line.slice(i + 1, close);
					const url = tail.url.trim();
					if (!isImage && isWebUrl(url) && !text.includes("![")) {
						links.push({
							from,
							to: tail.end,
							url,
							syntax: "markdown",
							text,
							rawTitle: tail.title,
							overrides: buildOverrides(url, text, tail.title),
						});
					}
					i = tail.end;
					continue;
				}
			}
		}

		if (c === "<") {
			const match = AUTOLINK.exec(line.slice(i));
			if (match) {
				links.push({
					from: i,
					to: i + match[0].length,
					url: match[1],
					syntax: "autolink",
					overrides: {},
				});
				i += match[0].length;
				continue;
			}
		}

		if ((c === "h" || c === "H") && (i === 0 || BARE_PREFIX_OK.test(line[i - 1]))) {
			const match = BARE_URL.exec(line.slice(i));
			if (match) {
				const url = trimBareUrl(match[0]);
				if (isWebUrl(url)) {
					links.push({ from: i, to: i + url.length, url, syntax: "bare", overrides: {} });
					i += url.length;
					continue;
				}
			}
		}

		i++;
	}

	return links;
}

/**
 * Returns the link if it stands completely alone on its line
 * (only whitespace before/after, at most 3 leading spaces), otherwise `null`.
 */
export function getStandaloneLink(line: string, links: ParsedLink[] = findLinksInLine(line)): ParsedLink | null {
	if (links.length !== 1) return null;
	const link = links[0];
	const before = line.slice(0, link.from);
	const after = line.slice(link.to);
	if (after.trim() !== "") return null;
	if (/^( {4,}|\t)/.test(before)) return null; // indented code block
	// Allow empty before or markdown quote/callout prefixes (e.g. "> ", "> > ")
	if (!/^(\s*>)*\s*$/.test(before)) return null;
	return link;
}

/** Classifies every link in a line as `block` or `inline`. */
export function classifyLine(line: string): Array<ParsedLink & { mode: DisplayMode }> {
	const links = findLinksInLine(line);
	const standalone = getStandaloneLink(line, links);
	return links.map((link) => ({ ...link, mode: link === standalone ? "block" : "inline" }));
}

/* ------------------------------------------------------------------------ */
/* Document scanning                                                         */
/* ------------------------------------------------------------------------ */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Parses a whole Markdown document and returns every web link with its
 * display mode. Fenced code blocks, math blocks and YAML frontmatter are
 * skipped entirely.
 */
export function parseDocument(text: string): DocumentLink[] {
	const lines = text.split("\n");
	const result: DocumentLink[] = [];
	let offset = 0;
	let fence: { char: string; length: number } | null = null;
	let inMath = false;
	let inFrontmatter = lines[0]?.trimEnd() === "---";

	lines.forEach((rawLine, index) => {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		const lineOffset = offset;
		offset += rawLine.length + 1;

		if (inFrontmatter) {
			if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) inFrontmatter = false;
			return;
		}

		if (fence) {
			const close = FENCE_OPEN.exec(line);
			if (
				close &&
				close[1][0] === fence.char &&
				close[1].length >= fence.length &&
				line.trim() === close[1]
			) {
				fence = null;
			}
			return;
		}

		const open = FENCE_OPEN.exec(line);
		if (open) {
			fence = { char: open[1][0], length: open[1].length };
			return;
		}

		if (inMath) {
			if (line.trim().endsWith("$$")) inMath = false;
			return;
		}
		if (line.trim().startsWith("$$")) {
			const rest = line.trim().slice(2);
			if (!rest.endsWith("$$") || rest.length === 0) inMath = true;
			return;
		}

		for (const link of classifyLine(line)) {
			result.push({
				...link,
				line: index,
				absFrom: lineOffset + link.from,
				absTo: lineOffset + link.to,
			});
		}
	});

	return result;
}
