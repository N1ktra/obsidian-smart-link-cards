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

function isInlineWhitespace(node: Node | null): boolean {
	return (
		!!node &&
		node.nodeType === Node.TEXT_NODE &&
		!(node.textContent ?? "").trim() &&
		!(node.textContent ?? "").includes("\n")
	);
}

function isBr(node: Node | null): node is HTMLBRElement {
	return !!node && node.nodeName === "BR";
}

function isIgnoredSibling(node: Node | null): boolean {
	if (!node) return false;
	if (isInlineWhitespace(node)) return true;
	if (node instanceof HTMLElement) {
		if (node.tagName === "SVG") return true;
		if (
			node.tagName !== "A" &&
			!node.classList.contains("slc-card") &&
			!node.classList.contains("slc-pill") &&
			/external-link-icon|link-icon/i.test(node.className)
		) {
			return true;
		}
	}
	return false;
}

function getMeaningfulSibling(node: Node | null, direction: "prev" | "next"): Node | null {
	let current = node;
	while (current && isIgnoredSibling(current)) {
		current = direction === "prev" ? current.previousSibling : current.nextSibling;
	}
	return current;
}

function isBlockBoundary(node: Node | null): boolean {
	if (node === null) return true;
	if (isBr(node)) return true;
	if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").includes("\n")) {
		return true;
	}
	if (node instanceof HTMLElement) {
		if (node.classList.contains("slc-card") || node.querySelector(".slc-card")) {
			return true;
		}
	}
	return false;
}

/** True if the anchor occupies a "line" of its own inside a paragraph, list item, or container. */
export function isStandaloneAnchor(anchor: HTMLElement): boolean {
	const parent = anchor.parentElement;
	if (!parent) return false;
	if (parent.tagName !== "P" && parent.tagName !== "LI" && parent.tagName !== "DIV") return false;
	if (anchor.closest("td, th, h1, h2, h3, h4, h5, h6, table")) return false;

	const prev = getMeaningfulSibling(anchor.previousSibling, "prev");
	const next = getMeaningfulSibling(anchor.nextSibling, "next");
	return isBlockBoundary(prev) && isBlockBoundary(next);
}

/** If the anchor is the only text inside a list item, return the `<li>` element. */
function getListItemForStandaloneAnchor(anchor: HTMLElement): HTMLElement | null {
	const li = anchor.closest("li");
	if (!li) return null;
	const fullText = (li.textContent ?? "").trim();
	const anchorText = (anchor.textContent ?? "").trim();
	return fullText === anchorText ? li : null;
}

function removeAdjacentBreak(node: Node | null, direction: "prev" | "next"): void {
	let current = node;
	while (current && isInlineWhitespace(current)) {
		current = direction === "prev" ? current.previousSibling : current.nextSibling;
	}
	if (isBr(current)) current.remove();
}

function removeAdjacentLeftoverIcons(anchor: HTMLElement): void {
	for (const dir of ["previousSibling", "nextSibling"] as const) {
		let current = anchor[dir];
		while (current) {
			if (isBlank(current)) {
				current = current[dir];
				continue;
			}
			if (
				current instanceof HTMLElement &&
				current.tagName !== "A" &&
				!current.classList.contains("slc-card") &&
				!current.classList.contains("slc-pill") &&
				(current.tagName === "SVG" || /external-link-icon|link-icon/i.test(current.className))
			) {
				const toRemove = current;
				current = current[dir];
				toRemove.remove();
				continue;
			}
			break;
		}
	}
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
			if (anchor.closest("code, pre, .slc-card, .slc-pill")) continue;
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

			let mode: DisplayMode = (source?.mode === "block" || isStandaloneAnchor(anchor)) ? "block" : "inline";
			if (mode === "block" && !settings.enableBlockCards) mode = "inline";
			if (mode === "inline" && !settings.enableInlinePills) continue;

			// Prefer the source URL so Live Preview and Reading view share cache keys.
			const url = source?.url ?? href;
			const mounted = mountLink({ url, syntax, overrides }, mode, deps);
			if (mode === "block") {
				removeAdjacentBreak(anchor.previousSibling, "prev");
				removeAdjacentBreak(anchor.nextSibling, "next");
				removeAdjacentLeftoverIcons(anchor);
				const standaloneLi = getListItemForStandaloneAnchor(anchor);
				if (standaloneLi) {
					standaloneLi.classList.add("slc-card-item");
				}
			} else {
				const standaloneLi = getListItemForStandaloneAnchor(anchor);
				if (standaloneLi) {
					standaloneLi.classList.add("slc-list-item");
				}
			}
			anchor.replaceWith(mounted.el);
			ctx.addChild(new LinkRenderChild(mounted.el, mounted.destroy));
		}
	};
}
