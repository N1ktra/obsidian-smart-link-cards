import { describe, expect, it, vi } from "vitest";
import { FAVICON_PROVIDERS } from "../src/favicon";
import {
	DEFAULT_SETTINGS,
	getSettingDefinitions,
	sanitizeSettings,
	type SettingKey,
	type SmartLinkCardsSettings,
} from "../src/settings";
import { SmartLinkCardsSettingTab } from "../src/settingsTab";

const CONTROL_VALUE_TYPE = { toggle: "boolean", dropdown: "string", number: "number" } as const;

describe("getSettingDefinitions (Obsidian 1.13+ native schema)", () => {
	const clearCache = vi.fn();
	const definitions = getSettingDefinitions({ clearCache });

	it("provides name and desc for every definition", () => {
		for (const def of definitions) {
			expect(def.name.trim()).not.toBe("");
			expect(def.desc).toBeDefined();
			expect(typeof def.desc).toBe("string");
		}
	});

	it("covers every settings key with a control", () => {
		const controlDefs = definitions.filter((d): d is typeof d & { control: { key: SettingKey; type: string } } => "control" in d && !!d.control);
		const keys = controlDefs.map((d) => d.control.key).sort();
		expect(keys).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("types of controls match default settings value types", () => {
		for (const def of definitions) {
			if (!("control" in def) || !def.control) continue;
			const { control } = def;
			const expectedVal = DEFAULT_SETTINGS[control.key];
			expect(typeof expectedVal).toBe(CONTROL_VALUE_TYPE[control.type as keyof typeof CONTROL_VALUE_TYPE]);
		}
	});

	it("dropdown control options match FAVICON_PROVIDERS", () => {
		const dropdown = definitions.find((d) => "control" in d && d.control?.type === "dropdown");
		expect(dropdown).toBeDefined();
		if (!dropdown || !("control" in dropdown) || !dropdown.control || dropdown.control.type !== "dropdown") return;
		expect(dropdown.control.options).toEqual(FAVICON_PROVIDERS);
		expect(dropdown.control.defaultValue).toBe(DEFAULT_SETTINGS.faviconProvider);
	});

	it("number control has min, max, step and valid defaultValue", () => {
		const numberDef = definitions.find((d) => "control" in d && d.control?.type === "number");
		expect(numberDef).toBeDefined();
		if (!numberDef || !("control" in numberDef) || !numberDef.control || numberDef.control.type !== "number") return;
		expect(numberDef.control.min).toBe(0);
		expect(numberDef.control.max).toBe(3650);
		expect(numberDef.control.step).toBe(1);
		expect(numberDef.control.defaultValue).toBe(DEFAULT_SETTINGS.cacheTtlDays);
	});

	it("includes a SettingDefinitionAction for clearing the cache", async () => {
		const actionDef = definitions.find((d) => "action" in d && typeof d.action === "function");
		expect(actionDef).toBeDefined();
		expect(actionDef?.name).toBe("Clear cache");
		if (!actionDef || !("action" in actionDef)) return;
		await actionDef.action({} as HTMLElement, 0);
		expect(clearCache).toHaveBeenCalledTimes(1);
	});
});

describe("SmartLinkCardsSettingTab (declarative tab)", () => {
	it("delegates getControlValue and setControlValue to plugin", async () => {
		const updateSetting = vi.fn();
		const mockPlugin = {
			settings: { ...DEFAULT_SETTINGS },
			updateSetting,
			clearCache: vi.fn(),
		};
		const tab = new SmartLinkCardsSettingTab({} as never, mockPlugin as never);

		expect(tab.getControlValue("enableBlockCards")).toBe(true);
		expect(tab.getControlValue("cacheTtlDays")).toBe(30);

		await tab.setControlValue("enableBlockCards", false);
		expect(updateSetting).toHaveBeenCalledWith("enableBlockCards", false);
	});

	it("returns valid definitions from getSettingDefinitions()", () => {
		const mockPlugin = {
			settings: { ...DEFAULT_SETTINGS },
			updateSetting: vi.fn(),
			clearCache: vi.fn(),
		};
		const tab = new SmartLinkCardsSettingTab({} as never, mockPlugin as never);
		const defs = tab.getSettingDefinitions();
		expect(defs.length).toBeGreaterThan(0);
		expect(defs.some((d) => "name" in d && d.name === "Block cards")).toBe(true);
	});
});

describe("sanitizeSettings", () => {
	it("returns defaults for missing data", () => {
		expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid values and rejects invalid ones", () => {
		expect(
			sanitizeSettings({
				enableBlockCards: false,
				enableInlinePills: "yes",
				faviconProvider: "bing",
				cacheTtlDays: Number.NaN,
				unknown: 1,
			}),
		).toEqual({ ...DEFAULT_SETTINGS, enableBlockCards: false });
	});

	it("clamps the cache TTL", () => {
		expect(sanitizeSettings({ cacheTtlDays: -5 }).cacheTtlDays).toBe(0);
		expect(sanitizeSettings({ cacheTtlDays: 7.6 }).cacheTtlDays).toBe(8);
	});
});
