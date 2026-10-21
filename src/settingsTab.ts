/**
 * Settings tab integrating with Obsidian 1.13+'s official declarative settings framework.
 *
 * In Obsidian 1.13+, the tab is rendered, indexed for search and managed declaratively
 * by Obsidian via `getSettingDefinitions()`, `getControlValue()` and `setControlValue()`.
 *
 * For Obsidian versions < 1.13.0, `display()` is implemented as a backward-compatible fallback.
 */
import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type SmartLinkCardsPlugin from "./main";
import { getSettingDefinitions, type SettingKey } from "./settings";

export class SmartLinkCardsSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SmartLinkCardsPlugin) {
		super(app, plugin);
	}

	/**
	 * Official declarative settings definition (Obsidian 1.13+).
	 * Obsidian automatically renders, searches and persists these definitions.
	 */
	override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return getSettingDefinitions({
			clearCache: () => this.plugin.clearCache(),
		});
	}

	/**
	 * Reads from plugin settings when Obsidian requests a control value.
	 */
	override getControlValue(key: string): unknown {
		return this.plugin.settings[key as SettingKey];
	}

	/**
	 * Persists updated control values when modified in the settings UI.
	 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		await this.plugin.updateSetting(key as SettingKey, value as never);
	}

	/**
	 * Fallback display() for Obsidian versions < 1.13.0.
	 * (In Obsidian 1.13+, display() is deprecated and never called if
	 * getSettingDefinitions() returns definitions).
	 */
	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const item of this.getSettingDefinitions()) {
			this.renderFallbackItem(containerEl, item);
		}
	}

	private renderFallbackItem(containerEl: HTMLElement, item: SettingDefinitionItem<SettingKey>): void {
		if ("type" in item && (item.type === "group" || item.type === "list")) {
			if (item.heading) {
				containerEl.createEl("h3", { text: item.heading });
			}
			for (const child of item.items ?? []) {
				this.renderFallbackItem(containerEl, child);
			}
			return;
		}

		if (!("name" in item)) return;

		const setting = new Setting(containerEl).setName(item.name);
		if (item.desc) setting.setDesc(item.desc);

		if ("action" in item && typeof item.action === "function") {
			setting.addButton((button) => {
				button
					.setButtonText(item.name)
					.setWarning()
					.onClick(async () => {
						button.setDisabled(true);
						try {
							await item.action(setting.settingEl, 0);
						} finally {
							button.setDisabled(false);
						}
					});
			});
			return;
		}

		if ("render" in item && typeof item.render === "function") {
			item.render(setting, null as never);
			return;
		}

		if ("control" in item && item.control) {
			const { control } = item;
			const currentVal = this.getControlValue(control.key);

			switch (control.type) {
				case "toggle":
					setting.addToggle((toggle) =>
						toggle.setValue(Boolean(currentVal)).onChange(async (val) => {
							await this.setControlValue(control.key, val);
						}),
					);
					break;

				case "dropdown":
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions(control.options)
							.setValue(String(currentVal))
							.onChange(async (val) => {
								await this.setControlValue(control.key, val);
							}),
					);
					break;

				case "number":
					setting.addText((text) => {
						text.inputEl.type = "number";
						if (control.min !== undefined) text.inputEl.min = String(control.min);
						if (control.max !== undefined) text.inputEl.max = String(control.max);
						if (control.step !== undefined) text.inputEl.step = String(control.step);
						text.setValue(String(currentVal ?? 0)).onChange(async (raw) => {
							const val = Number(raw);
							if (!Number.isFinite(val)) return;
							if (control.min !== undefined && val < control.min) return;
							if (control.max !== undefined && val > control.max) return;
							await this.setControlValue(control.key, val);
						});
					});
					break;
			}
		}
	}
}
