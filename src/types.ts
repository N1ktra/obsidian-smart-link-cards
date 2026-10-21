/**
 * Shared type definitions for Smart Link Cards.
 */

/** Crawled metadata for a single URL as it is persisted in `cache.json`. */
export interface LinkMetadata {
	title?: string;
	description?: string;
	faviconUrl?: string;
	/** Immutable timestamp (ms since epoch) of the successful fetch. */
	fetchedAt: number;
}

/** A manual icon given via the Markdown title attribute (`"Desc | 🎓"`). */
export type ManualIcon =
	| { type: "url"; value: string }
	| { type: "emoji"; value: string };

/** Manual values that always take precedence over crawled metadata. */
export interface LinkOverrides {
	title?: string;
	description?: string;
	icon?: ManualIcon;
}

/**
 * - `markdown`: `[Text](https://… "title")`
 * - `bare`:     `https://…`
 * - `autolink`: `<https://…>`
 */
export type LinkSyntax = "markdown" | "bare" | "autolink";

/** How a link is visually rendered. */
export type DisplayMode = "block" | "inline";

/** A web link found in a single line of Markdown source. */
export interface ParsedLink {
	/** Start offset (inclusive) relative to the start of the line. */
	from: number;
	/** End offset (exclusive) relative to the start of the line. */
	to: number;
	url: string;
	syntax: LinkSyntax;
	/** Raw link text inside `[...]` (markdown syntax only). */
	text?: string;
	/** Raw title attribute inside the parentheses (markdown syntax only). */
	rawTitle?: string;
	overrides: LinkOverrides;
}

/** A web link found in a full document (with absolute offsets). */
export interface DocumentLink extends ParsedLink {
	/** Zero-based line number. */
	line: number;
	/** Absolute start offset within the document. */
	absFrom: number;
	/** Absolute end offset within the document. */
	absTo: number;
	mode: DisplayMode;
}
