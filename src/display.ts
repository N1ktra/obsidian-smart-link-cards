/**
 * Pure view-model resolution: merges manual overrides, cached metadata and
 * settings into the data shown by cards and pills. No DOM, no Obsidian API.
 */
import { faviconCandidates, getHostname } from "./favicon";
import type { SmartLinkCardsSettings } from "./settings";
import type { DisplayMode, LinkMetadata, LinkOverrides, LinkSyntax } from "./types";

export interface LinkDescriptor {
	url: string;
	syntax: LinkSyntax;
	overrides: LinkOverrides;
}

export interface DisplayData {
	url: string;
	title: string;
	description?: string;
	hostname: string;
	/** Emoji/text icon (manual override) – takes precedence over images. */
	emoji?: string;
	/** Ordered image URLs to try. */
	iconCandidates: string[];
	/** True while metadata is still being fetched for the first time. */
	loading: boolean;
}

/** Shortened, human-readable URL (`example.com/path…`). */
export function prettyUrl(url: string, maxLength = 60): string {
	const text = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Whether rendering this link benefits from crawled metadata at all. */
export function needsMetadata(link: LinkDescriptor, mode: DisplayMode, settings: SmartLinkCardsSettings): boolean {
	const { overrides } = link;
	const needsSiteIcon = settings.faviconProvider === "site" && !overrides.icon;
	if (mode === "block") {
		return !overrides.title || !overrides.description || needsSiteIcon;
	}
	const wantsTitle = !overrides.title && link.syntax !== "markdown" && settings.showTitleForBareInlineUrls;
	return wantsTitle || needsSiteIcon;
}

export function resolveDisplay(
	link: LinkDescriptor,
	mode: DisplayMode,
	metadata: LinkMetadata | undefined,
	settings: SmartLinkCardsSettings,
): DisplayData {
	const { overrides, url } = link;
	const hostname = getHostname(url) || url;

	let title: string;
	if (mode === "block") {
		title = overrides.title ?? metadata?.title ?? prettyUrl(url);
	} else {
		title =
			overrides.title ??
			(settings.showTitleForBareInlineUrls ? metadata?.title : undefined) ??
			prettyUrl(url);
	}

	const candidates = faviconCandidates(url, metadata, settings.faviconProvider);
	let emoji: string | undefined;
	if (overrides.icon?.type === "emoji") emoji = overrides.icon.value;
	else if (overrides.icon?.type === "url") candidates.unshift(overrides.icon.value);

	return {
		url,
		title,
		description: overrides.description ?? metadata?.description,
		hostname,
		emoji,
		iconCandidates: Array.from(new Set(candidates)),
		loading: !metadata && needsMetadata(link, mode, settings),
	};
}
