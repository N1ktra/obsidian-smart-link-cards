/**
 * Live Preview integration via CodeMirror 6 decorations.
 *
 * The document is never modified – links are only *replaced visually* by
 * widgets. As soon as a selection touches a link (inline) or its line
 * (block), the decoration is dropped and the original Markdown is shown.
 */
import { syntaxTree } from "@codemirror/language";
import { StateEffect, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	keymap,
	type DecorationSet,
	type ViewUpdate,
} from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { findLinksInLine, getStandaloneLink } from "./parser";
import { mountLink, type RenderDeps } from "./render";
import type { DisplayMode, ParsedLink } from "./types";

/** Dispatch this effect to force a rebuild (e.g. after settings changed). */
export const refreshDecorationsEffect = StateEffect.define<null>();

/** Syntax nodes in which links must never be decorated. */
const SKIPPED_NODE = /codeblock|inline-code|frontmatter|math|comment|hmd-html|templater/i;

/** Rough card height used by CodeMirror for height estimation. */
const CARD_HEIGHT_ESTIMATE = 78;

const blockLineDecoration = Decoration.line({ class: "slc-block-line" });
/** Line with a visible card: lets CSS hide Obsidian's leftover link decorations (e.g. the external-link icon). */
const cardLineDecoration = Decoration.line({ class: "slc-block-line slc-card-line" });

function sameOverrides(a: ParsedLink, b: ParsedLink): boolean {
	return (
		a.overrides.title === b.overrides.title &&
		a.overrides.description === b.overrides.description &&
		a.overrides.icon?.type === b.overrides.icon?.type &&
		a.overrides.icon?.value === b.overrides.icon?.value
	);
}

class LinkWidget extends WidgetType {
	private static readonly destroyers = new WeakMap<HTMLElement, () => void>();

	constructor(
		readonly link: ParsedLink,
		readonly mode: DisplayMode,
		readonly deps: RenderDeps,
		readonly version: number,
	) {
		super();
	}

	eq(other: LinkWidget): boolean {
		return (
			other.mode === this.mode &&
			other.version === this.version &&
			other.link.url === this.link.url &&
			other.link.syntax === this.link.syntax &&
			sameOverrides(other.link, this.link)
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const mounted = mountLink(this.link, this.mode, this.deps, {
			onEdit: () => {
				const pos = view.posAtDOM(mounted.el);
				view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
				view.focus();
			},
		});
		LinkWidget.destroyers.set(mounted.el, mounted.destroy);
		return mounted.el;
	}

	destroy(dom: HTMLElement): void {
		LinkWidget.destroyers.get(dom)?.();
		LinkWidget.destroyers.delete(dom);
	}

	get estimatedHeight(): number {
		return this.mode === "block" ? CARD_HEIGHT_ESTIMATE : -1;
	}

	ignoreEvent(): boolean {
		// The widget handles its own mouse/keyboard events.
		return true;
	}
}

function isInSkippedNode(state: EditorState, from: number, to: number): boolean {
	let skipped = false;
	syntaxTree(state).iterate({
		from,
		to,
		enter: (node) => {
			if (skipped) return false;
			if (node.from < to && node.to > from && SKIPPED_NODE.test(node.name)) {
				skipped = true;
				return false;
			}
			return undefined;
		},
	});
	return skipped;
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

export interface LivePreviewHost extends RenderDeps {
	getVersion: () => number;
}

function isStandaloneBlockCard(
	state: EditorState,
	line: { text: string; from: number; to: number },
	host: LivePreviewHost,
): boolean {
	if (!host.getSettings().enableBlockCards) return false;
	if (!line.text.includes("http")) return false;
	const links = findLinksInLine(line.text);
	if (links.length === 0) return false;
	const standalone = getStandaloneLink(line.text, links);
	if (!standalone) return false;
	const absFrom = line.from + standalone.from;
	const absTo = line.from + standalone.to;
	return !isInSkippedNode(state, absFrom, absTo);
}

function createNavigationKeymap(host: LivePreviewHost): Extension {
	return keymap.of([
		{
			key: "ArrowDown",
			run: (view: EditorView) => {
				const { state } = view;
				if (!state.field(editorLivePreviewField, false)) return false;
				if (!state.selection.main.empty) return false;

				const pos = state.selection.main.head;
				const currentLine = state.doc.lineAt(pos);
				if (currentLine.number >= state.doc.lines) return false;

				try {
					const cursorBlock = view.lineBlockAt(pos);
					const lineEndBlock = view.lineBlockAt(currentLine.to);
					if (cursorBlock.bottom < lineEndBlock.bottom - 2) return false;
				} catch {
					// Layout measurement fallback
				}

				const nextLine = state.doc.line(currentLine.number + 1);
				if (!isStandaloneBlockCard(state, nextLine, host)) return false;

				const col = pos - currentLine.from;
				const targetPos = Math.min(nextLine.from + col, nextLine.to);
				view.dispatch({ selection: { anchor: targetPos }, scrollIntoView: true });
				return true;
			},
		},
		{
			key: "ArrowUp",
			run: (view: EditorView) => {
				const { state } = view;
				if (!state.field(editorLivePreviewField, false)) return false;
				if (!state.selection.main.empty) return false;

				const pos = state.selection.main.head;
				const currentLine = state.doc.lineAt(pos);
				if (currentLine.number <= 1) return false;

				try {
					const cursorBlock = view.lineBlockAt(pos);
					const lineStartBlock = view.lineBlockAt(currentLine.from);
					if (cursorBlock.top > lineStartBlock.top + 2) return false;
				} catch {
					// Layout measurement fallback
				}

				const prevLine = state.doc.line(currentLine.number - 1);
				if (!isStandaloneBlockCard(state, prevLine, host)) return false;

				const col = pos - currentLine.from;
				const targetPos = Math.min(prevLine.from + col, prevLine.to);
				view.dispatch({ selection: { anchor: targetPos }, scrollIntoView: true });
				return true;
			},
		},
	]);
}

function buildDecorations(view: EditorView, host: LivePreviewHost): DecorationSet {
	const { state } = view;
	if (!state.field(editorLivePreviewField, false)) return Decoration.none;

	const settings = host.getSettings();
	if (!settings.enableBlockCards && !settings.enableInlinePills) return Decoration.none;

	const version = host.getVersion();
	const decorations: Array<Range<Decoration>> = [];

	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = state.doc.lineAt(pos);
			pos = line.to + 1;
			if (!line.text.includes("http")) continue;

			const links = findLinksInLine(line.text);
			if (links.length === 0) continue;
			const standalone = getStandaloneLink(line.text, links);

			for (const link of links) {
				const absFrom = line.from + link.from;
				const absTo = line.from + link.to;
				if (isInSkippedNode(state, absFrom, absTo)) continue;

				if (link === standalone && settings.enableBlockCards) {
					// The line class reserves the card height in both states to avoid layout jumps.
					if (selectionTouches(state, line.from, line.to)) {
						decorations.push(blockLineDecoration.range(line.from));
						continue;
					}
					decorations.push(cardLineDecoration.range(line.from));
					// Replace the entire line (or link range if line starts with a quote prefix to avoid CM6 decoration collisions).
					const replaceFrom = line.text.trimStart().startsWith(">") ? absFrom : line.from;
					decorations.push(
						Decoration.replace({ widget: new LinkWidget(link, "block", host, version) }).range(replaceFrom, line.to),
					);
					continue;
				}

				if (!settings.enableInlinePills) continue;
				if (selectionTouches(state, absFrom, absTo)) continue;
				decorations.push(
					Decoration.replace({ widget: new LinkWidget(link, "inline", host, version) }).range(absFrom, absTo),
				);
			}
		}
	}

	return Decoration.set(decorations, true);
}

export function createLivePreviewExtension(host: LivePreviewHost): Extension {
	return [
		createNavigationKeymap(host),
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = buildDecorations(view, host);
				}

				update(update: ViewUpdate) {
					const livePreviewToggled =
						update.startState.field(editorLivePreviewField, false) !==
						update.state.field(editorLivePreviewField, false);
					const forced = update.transactions.some((tr) =>
						tr.effects.some((effect) => effect.is(refreshDecorationsEffect)),
					);
					const emptyDecorations = this.decorations.size === 0;
					if (
						update.docChanged ||
						update.viewportChanged ||
						update.selectionSet ||
						livePreviewToggled ||
						forced ||
						syntaxTree(update.startState) !== syntaxTree(update.state) ||
						(emptyDecorations && update.geometryChanged)
					) {
						this.decorations = buildDecorations(update.view, host);
					}
				}
			},
			{ decorations: (plugin) => plugin.decorations },
		),
	];
}
