/**
 * Minimal runtime mock of the "obsidian" module for Vitest.
 * (The real package only contains type declarations.)
 */
import { vi } from "vitest";

export const requestUrl = vi.fn();
export const setIcon = vi.fn();
export const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/");
export const editorLivePreviewField = {};

export class Notice {
	constructor(public message: string) {}
}

export class MarkdownRenderChild {
	constructor(public containerEl: unknown) {}
	onunload(): void {}
}

export class Plugin {}

export class PluginSettingTab {
	containerEl: HTMLElement = {
		empty: vi.fn(),
		createEl: vi.fn(() => ({})),
	} as unknown as HTMLElement;

	constructor(public app: unknown, public plugin: unknown) {}

	getSettingDefinitions(): unknown[] {
		return [];
	}

	getControlValue(_key: string): unknown {
		return undefined;
	}

	setControlValue(_key: string, _value: unknown): void | Promise<void> {}

	display(): void {}
	hide(): void {}
}

export class Setting {
	name = "";
	desc = "";
	settingEl: HTMLElement = {} as HTMLElement;

	constructor(public containerEl: unknown) {}

	setName(name: string): this {
		this.name = name;
		return this;
	}

	setDesc(desc: string | DocumentFragment): this {
		this.desc = typeof desc === "string" ? desc : "";
		return this;
	}

	addToggle(cb: (t: { setValue: (v: boolean) => unknown; onChange: (fn: (v: boolean) => unknown) => unknown }) => unknown): this {
		cb({ setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis() });
		return this;
	}

	addDropdown(cb: (d: { addOptions: (o: unknown) => unknown; setValue: (v: string) => unknown; onChange: (fn: (v: string) => unknown) => unknown }) => unknown): this {
		cb({ addOptions: vi.fn().mockReturnThis(), setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis() });
		return this;
	}

	addText(cb: (t: { inputEl: Record<string, string>; setValue: (v: string) => unknown; onChange: (fn: (v: string) => unknown) => unknown }) => unknown): this {
		cb({ inputEl: {}, setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis() });
		return this;
	}

	addButton(cb: (b: { setButtonText: (t: string) => unknown; setWarning: () => unknown; onClick: (fn: () => unknown) => unknown; setDisabled: (d: boolean) => unknown }) => unknown): this {
		cb({ setButtonText: vi.fn().mockReturnThis(), setWarning: vi.fn().mockReturnThis(), onClick: vi.fn().mockReturnThis(), setDisabled: vi.fn().mockReturnThis() });
		return this;
	}
}

export class MarkdownView {}
