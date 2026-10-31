import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	normalizePath,
	type DataAdapter,
	type SettingDefinition,
} from "obsidian";
import type { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { LinkCache, type CacheStorage } from "./cache";
import { createLivePreviewExtension, refreshDecorationsEffect } from "./livePreview";
import { LinkMetadataService } from "./metadataService";
import { parseDocument } from "./parser";
import { createReadingModeProcessor } from "./readingMode";
import { clearIconCache } from "./render";
import {
	getSettingDefinitions,
	sanitizeSettings,
	type SettingKey,
	type SmartLinkCardsSettings,
} from "./settings";
import { SmartLinkCardsSettingTab } from "./settingsTab";

/** Stores the cache as `cache.json` next to `data.json` in the plugin folder. */
class AdapterCacheStorage implements CacheStorage {
	constructor(
		private readonly adapter: DataAdapter,
		private readonly path: string,
	) {}

	async read(): Promise<string | null> {
		if (!(await this.adapter.exists(this.path))) return null;
		return this.adapter.read(this.path);
	}

	async write(data: string): Promise<void> {
		await this.adapter.write(this.path, data);
	}
}

/** Settings that only influence fetching, not rendering. */
const NON_VISUAL_SETTINGS = new Set<keyof SmartLinkCardsSettings>(["cacheTtlDays"]);

export default class SmartLinkCardsPlugin extends Plugin {
	settings!: SmartLinkCardsSettings;
	cache!: LinkCache;
	service!: LinkMetadataService;
	private renderVersion = Date.now();

	async onload(): Promise<void> {
		await this.loadSettings();

		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.cache = new LinkCache(
			new AdapterCacheStorage(this.app.vault.adapter, normalizePath(`${pluginDir}/cache.json`)),
		);
		await this.cache.load();

		this.service = new LinkMetadataService(this.cache, {
			getTtlDays: () => this.settings.cacheTtlDays,
		});

		const deps = {
			service: this.service,
			getSettings: () => this.settings,
			getVersion: () => this.renderVersion,
			resolveVaultPath: (path: string) => this.resolveVaultPath(path),
		};

		this.registerEditorExtension(Prec.highest(createLivePreviewExtension(deps)));
		this.registerMarkdownPostProcessor(createReadingModeProcessor(deps));
		this.addSettingTab(new SmartLinkCardsSettingTab(this.app, this));

		this.addCommand({
			id: "clear-cache",
			name: "Clear link metadata cache",
			callback: () => void this.clearCache(),
		});

		this.addCommand({
			id: "refetch-active-note-links",
			name: "Refetch all links in active note",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (checking) return true;
				void this.refetchActiveNoteLinks(view);
				return true;
			},
		});

		if (this.app.workspace.layoutReady) {
			this.refreshViews(false);
		} else {
			this.app.workspace.onLayoutReady(() => {
				this.refreshViews(false);
			});
		}

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
					cm?.dispatch({ effects: refreshDecorationsEffect.of(null) });
				}
			}),
		);
	}

	/** Resolves a vault file path / wikilink target (e.g. `[[Bild.jpg]]`) to a local resource URI. */
	resolveVaultPath(path: string): string | null {
		const cleanPath = path.trim();
		if (!cleanPath) return null;
		const file =
			this.app.metadataCache.getFirstLinkpathDest(cleanPath, "") ??
			this.app.vault.getAbstractFileByPath(cleanPath) ??
			this.app.vault.getAbstractFileByPath(normalizePath(cleanPath));
		if (file instanceof TFile) {
			return this.app.vault.getResourcePath(file);
		}
		return null;
	}

	onunload(): void {
		// Persist pending (debounced) changes – a no-op if nothing changed.
		void this.cache?.flush();
		this.cache?.dispose();
	}

	/** Native descriptive settings schema consumed by Obsidian 1.13+ and the settings tab. */
	getSettingDefinitions(): SettingDefinition<SettingKey>[] {
		return getSettingDefinitions({ clearCache: () => this.clearCache() });
	}

	async loadSettings(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
	}

	async updateSetting<K extends keyof SmartLinkCardsSettings>(
		key: K,
		value: SmartLinkCardsSettings[K],
	): Promise<void> {
		if (this.settings[key] === value) return;
		this.settings = sanitizeSettings({ ...this.settings, [key]: value });
		await this.saveData(this.settings);
		if (!NON_VISUAL_SETTINGS.has(key)) this.refreshViews();
	}

	async clearCache(): Promise<void> {
		await this.cache.clear();
		this.service.reset();
		clearIconCache();
		this.refreshViews();
		new Notice("Smart Link Cards: cache cleared.");
	}

	/** Refetches metadata for all web links in the active note, bypassing cache. */
	async refetchActiveNoteLinks(view: MarkdownView): Promise<void> {
		const text = view.editor.getValue();
		const links = parseDocument(text);
		const urls = Array.from(new Set(links.map((l) => l.url)));

		if (urls.length === 0) {
			new Notice("Smart Link Cards: No web links found in active note.");
			return;
		}

		new Notice(`Smart Link Cards: Refetching ${urls.length} link${urls.length === 1 ? "" : "s"}…`);
		for (const url of urls) {
			this.service.request(url, true);
		}

		await this.service.idle();
		this.refreshViews(true);
		new Notice(`Smart Link Cards: Refreshed ${urls.length} link${urls.length === 1 ? "" : "s"}.`);
	}

	/** Re-renders all open Live Preview editors and Reading views. */
	refreshViews(bumpVersion = true): void {
		if (bumpVersion) this.renderVersion++;
		this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			const cm = (view.editor as unknown as { cm?: EditorView }).cm;
			cm?.dispatch({ effects: refreshDecorationsEffect.of(null) });
			if (view.getMode() === "preview") view.previewMode.rerender(true);
		});
	}
}
