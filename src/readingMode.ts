/**
 * Reading view integration via `registerMarkdownPostProcessor`.
 * Works purely on the rendered HTML; the Markdown file is never touched.
 */
import { MarkdownRenderChild, type MarkdownPostProcessor, type MarkdownPostProcessorContext } from "obsidian";
import { isWebUrl, normalizeUrl, parseDocument, parseTitleOverrides, stripInlineMarkdown } from "./parser";
import { mountLink, type RenderDeps } from "./render";
import type { DisplayMode, DocumentLink, LinkOverrides, LinkSyntax } from "./types";

class LinkRenderChild extends MarkdownRenderChild {
	constructor(containerEl: HTMLElement, private readonly destroy: () => void) {
		super(containerEl);
	}

	onunload(): void {
		this.destroy();
	}
}

function comparableUrl(url: string): string {
	const normalized = normalizeUrl(url);
	try {
		return decodeURI(new URL(normalized).href).replace(/\/$/, "");
	} catch {
		return normalized.replace(/\/$/, "");
	}
}

function isBlank(node: Node | null): boolean {
	return !!node && node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim();
}

function isBr(node: Node | null): node is HTMLBRElement {
	return !!node && node.nodeName === "BR";
}

/** True if the anchor occupies a "line" of its own inside a paragraph. */
function isStandaloneAnchor(anchor: HTMLElement): boolean {
	const parent = anchor.parentElement;
	if (!parent || parent.tagName !== "P") return false;
	if (anchor.closest("li, td, th, blockquote, h1, h2, h3, h4, h5, h6, table")) return false;

	let prev = anchor.previousSibling;
	while (prev && isBlank(prev)) prev = prev.previousSibling;
	let next = anchor.nextSibling;
	while (next && isBlank(next)) next = next.nextSibling;
	return (prev === null || isBr(prev)) && (next === null || isBr(next));
}

function removeAdjacentBreak(node: Node | null, direction: "prev" | "next"): void {
	let current = node;
	while (current && isBlank(current)) {
		current = direction === "prev" ? current.previousSibling : current.nextSibling;
	}
	if (isBr(current)) current.remove();
}

function getSourceLinks(el: HTMLElement, ctx: MarkdownPostProcessorContext): DocumentLink[] {
	const info = ctx.getSectionInfo(el);
	if (!info) return [];
	const section = info.text.split("\n").slice(info.lineStart, info.lineEnd + 1).join("\n");
	return parseDocument(section);
}

export function createReadingModeProcessor(deps: RenderDeps): MarkdownPostProcessor {
	return (el, ctx) => {
		const settings = deps.getSettings();
		if (!settings.enableInReadingMode) return;
		if (!settings.enableBlockCards && !settings.enableInlinePills) return;

		const anchors = Array.from(el.querySelectorAll<HTMLAnchorElement>("a.external-link"));
		if (anchors.length === 0) return;

		const sourceLinks = getSourceLinks(el, ctx);
		const used = new Set<DocumentLink>();

		for (const anchor of anchors) {
			if (anchor.closest("code, pre, .slc-card, .slc-pill, .internal-embed")) continue;
			if (anchor.querySelector("img")) continue; // badges / image links

			const href = anchor.getAttribute("href") ?? "";
			if (!isWebUrl(href)) continue;

			const target = comparableUrl(href);
			const source = sourceLinks.find((link) => !used.has(link) && comparableUrl(link.url) === target);
			if (source) used.add(source);

			const text = (anchor.textContent ?? "").trim();
			let syntax: LinkSyntax;
			let overrides: LinkOverrides;
			if (source) {
				syntax = source.syntax;
				overrides = source.overrides;
			} else {
				const looksBare = !text || comparableUrl(text) === target || text === href;
				syntax = looksBare ? "bare" : "markdown";
				overrides = { ...parseTitleOverrides(anchor.getAttribute("title") ?? undefined) };
				if (!looksBare) overrides.title = stripInlineMarkdown(text);
			}

			let mode: DisplayMode = isStandaloneAnchor(anchor) ? "block" : "inline";
			if (mode === "block" && !settings.enableBlockCards) mode = "inline";
			if (mode === "inline" && !settings.enableInlinePills) continue;

			// Prefer the source URL so Live Preview and Reading view share cache keys.
			const url = source?.url ?? href;
			const mounted = mountLink({ url, syntax, overrides }, mode, deps);
			if (mode === "block") {
				removeAdjacentBreak(anchor.previousSibling, "prev");
				removeAdjacentBreak(anchor.nextSibling, "next");
				// Remove leftover icon siblings (e.g. SVGs injected by themes or Obsidian)
				const parent = anchor.parentElement;
				if (parent && parent.tagName === "P") {
					for (const sibling of Array.from(parent.children)) {
						if (
							sibling !== anchor &&
							(sibling.tagName === "SVG" ||
								(sibling instanceof HTMLElement && /external|link/i.test(sibling.className)))
						) {
							sibling.remove();
						}
					}
				}
			}
			anchor.replaceWith(mounted.el);
			ctx.addChild(new LinkRenderChild(mounted.el, mounted.destroy));
		}
	};
}
