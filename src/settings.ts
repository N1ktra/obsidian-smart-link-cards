/**
 * Settings model and the official Obsidian declarative settings schema (Obsidian 1.13+).
 *
 * Uses the official SettingDefinition / SettingControl types directly from "obsidian".
 */
import type {
	SettingDefinition,
	SettingDefinitionAction,
	SettingDropdownControl,
	SettingNumberControl,
	SettingToggleControl,
} from "obsidian";
import { FAVICON_PROVIDERS, type FaviconProvider } from "./favicon";

export interface SmartLinkCardsSettings {
	enableBlockCards: boolean;
	enableInlinePills: boolean;
	showThumbnailInCards: boolean;
	showTitleForBareInlineUrls: boolean;
	showDescriptionInInlinePills: boolean;
	showManualDescriptionInInlinePills: boolean;
	enableInReadingMode: boolean;
	faviconProvider: FaviconProvider;
	cacheTtlDays: number;
}

export const DEFAULT_SETTINGS: Readonly<SmartLinkCardsSettings> = Object.freeze({
	enableBlockCards: true,
	enableInlinePills: true,
	showThumbnailInCards: true,
	showTitleForBareInlineUrls: true,
	showDescriptionInInlinePills: false,
	showManualDescriptionInInlinePills: true,
	enableInReadingMode: true,
	faviconProvider: "google",
	cacheTtlDays: 30,
});

export type SettingKey = keyof SmartLinkCardsSettings;

export interface SettingActions {
	clearCache: () => void | Promise<void>;
}

/**
 * The single source of truth for plugin settings, conforming to Obsidian 1.13+
 * native declarative SettingDefinition schema.
 */
export function getSettingDefinitions(actions: SettingActions): SettingDefinition<SettingKey>[] {
	return [
		{
			name: "Block cards",
			desc: "Render links that stand alone on their own line as Notion-style cards.",
			control: {
				type: "toggle",
				key: "enableBlockCards",
				defaultValue: DEFAULT_SETTINGS.enableBlockCards,
			} satisfies SettingToggleControl<SettingKey>,
		},
		{
			name: "Thumbnails in cards",
			desc: "Show webpage thumbnail preview image when available on block cards.",
			control: {
				type: "toggle",
				key: "showThumbnailInCards",
				defaultValue: DEFAULT_SETTINGS.showThumbnailInCards,
			} satisfies SettingToggleControl<SettingKey>,
		},
		{
			name: "Inline pills",
			desc: "Render links inside running text, lists and tables as compact pills with favicon.",
			control: {
				type: "toggle",
				key: "enableInlinePills",
				defaultValue: DEFAULT_SETTINGS.enableInlinePills,
			} satisfies SettingToggleControl<SettingKey>,
		},
		{
			name: "Page title for bare inline URLs",
			desc: "Show the crawled page title instead of the raw URL inside inline pills.",
			control: {
				type: "toggle",
				key: "showTitleForBareInlineUrls",
				defaultValue: DEFAULT_SETTINGS.showTitleForBareInlineUrls,
			} satisfies SettingToggleControl<SettingKey>,
		},
		{
			name: "Description in inline pills",
			desc: "Show page description inside inline pills.",
			control: {
				type: "toggle",
				key: "showDescriptionInInlinePills",
				defaultValue: DEFAULT_SETTINGS.showDescriptionInInlinePills,
			} satisfies SettingToggleControl<SettingKey>,
		},
		{
			name: "Show manual description in inline pills",
			desc: "Show manually provided descriptions in light grey next to the pill (defined via link title: [Link](url \"Description | Icon\")).",
			control: {
				type: "toggle",
				key: "showManualDescriptionInInlinePills",
				defaultValue: DEFAULT_SETTINGS.showManualDescriptionInInlinePills,
			} satisfies SettingToggleControl<SettingKey>,
		},
		{
			name: "Reading view",
			desc: "Also enhance links in Reading view (Live Preview is always enhanced).",
			control: {
				type: "toggle",
				key: "enableInReadingMode",
				defaultValue: DEFAULT_SETTINGS.enableInReadingMode,
			} satisfies SettingToggleControl<SettingKey>,
		},
		{
			name: "Favicon provider",
			desc: "Service used to resolve favicons (overridden if set via [Link](url \"Desc | [[image.png]]\")). Icons are referenced by URL and never stored in your vault.",
			control: {
				type: "dropdown",
				key: "faviconProvider",
				options: { ...FAVICON_PROVIDERS },
				defaultValue: DEFAULT_SETTINGS.faviconProvider,
			} satisfies SettingDropdownControl<SettingKey>,
		},
		{
			name: "Cache validity (days)",
			desc: "After this many days metadata is refreshed in the background. 0 = never expire.",
			control: {
				type: "number",
				key: "cacheTtlDays",
				min: 0,
				max: 3650,
				step: 1,
				defaultValue: DEFAULT_SETTINGS.cacheTtlDays,
			} satisfies SettingNumberControl<SettingKey>,
		},
		{
			name: "Clear cache",
			desc: "Delete all cached link metadata (cache.json in the plugin folder).",
			action: async () => {
				await actions.clearCache();
			},
		} satisfies SettingDefinitionAction,
	];
}

/** Validates persisted settings and falls back to defaults for invalid values. */
export function sanitizeSettings(raw: unknown): SmartLinkCardsSettings {
	const input = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<SettingKey, unknown>>;
	const result: SmartLinkCardsSettings = { ...DEFAULT_SETTINGS };

	for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
		const value = input[key];
		const fallback = DEFAULT_SETTINGS[key];
		if (typeof value !== typeof fallback) continue;
		if (typeof value === "number" && !Number.isFinite(value)) continue;
		(result as unknown as Record<string, unknown>)[key] = value;
	}

	if (!(result.faviconProvider in FAVICON_PROVIDERS)) {
		result.faviconProvider = DEFAULT_SETTINGS.faviconProvider;
	}
	result.cacheTtlDays = Math.max(0, Math.min(3650, Math.round(result.cacheTtlDays)));
	return result;
}
