/**
 * Native DOM rendering of block cards and inline pills (no UI framework).
 * Shared by the Live Preview widgets and the Reading view post processor.
 */
import { setIcon } from "obsidian";
import { needsMetadata, resolveDisplay, type DisplayData, type LinkDescriptor } from "./display";
import type { LinkMetadataService } from "./metadataService";
import type { SmartLinkCardsSettings } from "./settings";
import type { DisplayMode } from "./types";

export interface RenderDeps {
	service: LinkMetadataService;
	getSettings: () => SmartLinkCardsSettings;
}

export interface MountOptions {
	/** Optional "edit source" action (Live Preview only). */
	onEdit?: () => void;
}

export interface MountedLink {
	el: HTMLElement;
	destroy: () => void;
}

function renderIcon(container: HTMLElement, data: DisplayData, size: number): void {
	if (data.emoji) {
		container.createSpan({ cls: "slc-emoji", text: data.emoji });
		return;
	}
	const candidates = [...data.iconCandidates];
	const img = container.createEl("img", {
		attr: {
			alt: "",
			width: String(size),
			height: String(size),
			loading: "lazy",
			decoding: "async",
			referrerpolicy: "no-referrer",
			draggable: "false",
		},
	});
	const tryNext = () => {
		const next = candidates.shift();
		if (next) {
			img.src = next;
			return;
		}
		img.remove();
		setIcon(container, "globe");
	};
	img.addEventListener("error", tryNext);
	tryNext();
}

function renderCard(el: HTMLElement, data: DisplayData, options: MountOptions): void {
	el.empty();
	el.toggleClass("slc-loading", data.loading);
	el.setAttr("aria-label", data.url);
	el.setAttr("data-tooltip-position", "top");

	renderIcon(el.createDiv({ cls: "slc-card-icon" }), data, 24);

	const body = el.createDiv({ cls: "slc-card-body" });
	body.createDiv({ cls: "slc-card-title", text: data.title });
	const description = data.description ?? (data.loading ? "Loading preview…" : data.url);
	body.createDiv({ cls: "slc-card-desc", text: description });

	el.createDiv({ cls: "slc-card-host", text: data.hostname });

	if (options.onEdit) {
		const edit = el.createDiv({ cls: "slc-card-edit clickable-icon", attr: { "aria-label": "Edit link" } });
		setIcon(edit, "pencil");
		edit.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			options.onEdit?.();
		});
	}
}

function renderPill(el: HTMLElement, data: DisplayData): void {
	el.empty();
	el.toggleClass("slc-loading", data.loading);
	el.setAttr("aria-label", data.description ? `${data.description}\n${data.url}` : data.url);
	el.setAttr("data-tooltip-position", "top");
	renderIcon(el.createSpan({ cls: "slc-pill-icon" }), data, 14);
	el.createSpan({ cls: "slc-pill-text", text: data.title });
}

export function openExternal(url: string): void {
	window.open(url, "_blank", "noopener");
}

/**
 * Creates a self-updating card/pill element. When metadata arrives (or is
 * refreshed) the element re-renders itself in place.
 */
export function mountLink(
	link: LinkDescriptor,
	mode: DisplayMode,
	deps: RenderDeps,
	options: MountOptions = {},
): MountedLink {
	const el =
		mode === "block"
			? createDiv({ cls: "slc-card" })
			: createSpan({ cls: "slc-pill" });
	el.setAttr("role", "link");
	el.setAttr("tabindex", "0");
	el.dataset.url = link.url;

	const paint = () => {
		const settings = deps.getSettings();
		const display = resolveDisplay(link, mode, deps.service.get(link.url), settings);
		display.loading = display.loading && deps.service.isPending(link.url);
		if (mode === "block") renderCard(el, display, options);
		else renderPill(el, display);
	};

	const unsubscribe = deps.service.subscribe(link.url, paint);
	if (needsMetadata(link, mode, deps.getSettings())) deps.service.request(link.url);
	paint();

	const open = (event: MouseEvent | KeyboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
		openExternal(link.url);
	};
	el.addEventListener("mousedown", (event) => {
		// Keep CodeMirror from moving the cursor into the widget.
		if (event.button === 0) event.preventDefault();
	});
	el.addEventListener("click", (event) => {
		if (event.button === 0) open(event);
	});
	el.addEventListener("auxclick", (event) => {
		if (event.button === 1) open(event);
	});
	el.addEventListener("keydown", (event) => {
		if (event.key === "Enter") open(event);
	});

	return { el, destroy: unsubscribe };
}
