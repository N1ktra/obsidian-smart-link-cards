/**
 * Native DOM rendering of block cards and inline pills (no UI framework).
 * Shared by the Live Preview widgets and the Reading view post processor.
 */
import { requestUrl, setIcon } from "obsidian";
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

/** In-memory cache for resolved favicon URLs: url -> data URL, or null if 404/failed. */
const resolvedIconCache = new Map<string, string | null>();
const pendingIconResolutions = new Map<string, Promise<string | null>>();

export function clearIconCache(): void {
	resolvedIconCache.clear();
	pendingIconResolutions.clear();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(buffer).toString("base64");
	}
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const len = bytes.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export async function resolveIconUrl(url: string): Promise<string | null> {
	if (resolvedIconCache.has(url)) {
		return resolvedIconCache.get(url)!;
	}
	if (pendingIconResolutions.has(url)) {
		return pendingIconResolutions.get(url)!;
	}
	if (url.startsWith("data:")) {
		if (url.length < 24 || !url.includes(",")) {
			resolvedIconCache.set(url, null);
			return null;
		}
		resolvedIconCache.set(url, url);
		return url;
	}

	const promise = (async () => {
		try {
			const res = await requestUrl({
				url,
				method: "GET",
				throw: false,
				headers: {
					Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
				},
			});
			// Must be 2xx/3xx and at least 40 bytes (DuckDuckGo and other services return dummy 1-byte responses when missing)
			if (res && res.status >= 200 && res.status < 400 && res.arrayBuffer && res.arrayBuffer.byteLength > 40) {
				const contentType = res.headers?.["content-type"] || "image/png";
				if (contentType.includes("svg")) {
					const text = typeof res.text === "string" ? res.text : "";
					if (!text.toLowerCase().includes("<svg")) {
						resolvedIconCache.set(url, null);
						return null;
					}
				}
				if (contentType.startsWith("image/") || contentType.includes("icon")) {
					const base64 = arrayBufferToBase64(res.arrayBuffer);
					const dataUrl = `data:${contentType};base64,${base64}`;
					resolvedIconCache.set(url, dataUrl);
					return dataUrl;
				}
			}
			resolvedIconCache.set(url, null);
			return null;
		} catch {
			resolvedIconCache.set(url, null);
			return null;
		} finally {
			pendingIconResolutions.delete(url);
		}
	})();

	pendingIconResolutions.set(url, promise);
	return promise;
}

function renderFallbackIcon(container: HTMLElement, size: number): void {
	container.empty();
	const badge = container.createSpan({ cls: "slc-fallback-badge" });
	try {
		setIcon(badge, "link-2");
	} catch {
		setIcon(badge, "link");
	}
}

function renderIcon(container: HTMLElement, data: DisplayData, size: number): void {
	if (data.emoji) {
		container.createSpan({ cls: "slc-emoji", text: data.emoji });
		return;
	}
	const candidates = [...data.iconCandidates];
	if (candidates.length === 0) {
		renderFallbackIcon(container, size);
		return;
	}

	// 1. If any candidate was already resolved successfully, render immediately:
	for (const candidate of candidates) {
		const cached = resolvedIconCache.get(candidate);
		if (cached) {
			container.empty();
			const img = container.createEl("img", {
				attr: {
					alt: "",
					width: String(size),
					height: String(size),
					src: cached,
					loading: "lazy",
					decoding: "async",
					draggable: "false",
				},
			});
			img.onerror = () => {
				resolvedIconCache.set(candidate, null);
				renderFallbackIcon(container, size);
			};
			return;
		}
	}

	// 2. If all candidates are already known to have failed, render fallback immediately:
	const remaining = candidates.filter((c) => resolvedIconCache.get(c) !== null);
	if (remaining.length === 0) {
		renderFallbackIcon(container, size);
		return;
	}

	// 3. Render fallback badge as instant placeholder:
	renderFallbackIcon(container, size);

	// 4. Resolve candidates safely via requestUrl (never produces browser DOM 404 console errors):
	void (async () => {
		for (const candidate of remaining) {
			const dataUrl = await resolveIconUrl(candidate);
			if (dataUrl) {
				if (container.parentElement) {
					container.empty();
					const img = container.createEl("img", {
						attr: {
							alt: "",
							width: String(size),
							height: String(size),
							src: dataUrl,
							loading: "lazy",
							decoding: "async",
							draggable: "false",
						},
					});
					img.onerror = () => {
						resolvedIconCache.set(candidate, null);
						renderFallbackIcon(container, size);
					};
				}
				return;
			}
		}
	})();
}

function renderCard(el: HTMLElement, data: DisplayData, options: MountOptions): void {
	el.toggleClass("slc-loading", data.loading);
	el.setAttr("aria-label", data.url);
	el.setAttr("data-tooltip-position", "top");

	let icon = el.querySelector<HTMLElement>(".slc-card-icon");
	if (!icon) {
		icon = el.createDiv({ cls: "slc-card-icon" });
	}
	renderIcon(icon, data, 24);

	let body = el.querySelector<HTMLElement>(".slc-card-body");
	let titleEl: HTMLElement;
	let descEl: HTMLElement;
	if (!body) {
		body = el.createDiv({ cls: "slc-card-body" });
		titleEl = body.createDiv({ cls: "slc-card-title", text: data.title });
		const description = data.description ?? (data.loading ? "Loading preview…" : data.url);
		descEl = body.createDiv({ cls: "slc-card-desc", text: description });
	} else {
		titleEl = body.querySelector<HTMLElement>(".slc-card-title") ?? body.createDiv({ cls: "slc-card-title" });
		descEl = body.querySelector<HTMLElement>(".slc-card-desc") ?? body.createDiv({ cls: "slc-card-desc" });
		titleEl.textContent = data.title;
		const description = data.description ?? (data.loading ? "Loading preview…" : data.url);
		descEl.textContent = description;
	}

	let host = el.querySelector<HTMLElement>(".slc-card-host");
	if (!host) {
		host = el.createDiv({ cls: "slc-card-host", text: data.hostname });
	} else {
		host.textContent = data.hostname;
	}

	if (options.onEdit && !el.querySelector(".slc-card-edit")) {
		const edit = el.createDiv({ cls: "slc-card-edit clickable-icon", attr: { "aria-label": "Edit link" } });
		setIcon(edit, "pencil");
		edit.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			options.onEdit?.();
		});
	}
}

function renderPill(el: HTMLElement, data: DisplayData, settings: SmartLinkCardsSettings): void {
	el.toggleClass("slc-loading", data.loading);
	el.setAttr("aria-label", data.description ? `${data.description}\n${data.url}` : data.url);
	el.setAttr("data-tooltip-position", "top");

	let icon = el.querySelector<HTMLElement>(".slc-pill-icon");
	if (!icon) {
		icon = el.createSpan({ cls: "slc-pill-icon" });
	}
	renderIcon(icon, data, 14);

	let textEl = el.querySelector<HTMLElement>(".slc-pill-text");
	if (!textEl) {
		textEl = el.createSpan({ cls: "slc-pill-text", text: data.title });
	} else {
		textEl.textContent = data.title;
	}

	const showDesc =
		(data.isManualDescription && settings.showManualDescriptionInInlinePills) ||
		(!data.isManualDescription && settings.showDescriptionInInlinePills);

	let descEl = el.querySelector<HTMLElement>(".slc-pill-desc");
	if (showDesc && data.description) {
		const cls = data.isManualDescription ? "slc-pill-desc slc-pill-desc-manual" : "slc-pill-desc";
		if (!descEl) {
			descEl = el.createSpan({ cls, text: data.description });
		} else {
			descEl.className = cls;
			descEl.textContent = data.description;
		}
	} else if (descEl) {
		descEl.remove();
	}
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
		else renderPill(el, display, settings);
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
