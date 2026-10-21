/**
 * Favicon helpers. Favicons are never downloaded into the vault – they are
 * referenced by URL and loaded by the renderer (`<img>`), which is not subject
 * to CORS restrictions.
 */
import type { LinkMetadata } from "./types";

export type FaviconProvider = "google" | "duckduckgo" | "site";

export const FAVICON_PROVIDERS: Record<FaviconProvider, string> = {
	google: "Google (s2/favicons)",
	duckduckgo: "DuckDuckGo (icons.duckduckgo.com)",
	site: "Website (<link rel=\"icon\">) with Google fallback",
};

/** Returns the hostname without a leading `www.` (empty string if invalid). */
export function getHostname(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, "");
	} catch {
		const match = /^https?:\/\/([^/?#:]+)/i.exec(url);
		return match ? match[1].replace(/^www\./i, "") : "";
	}
}

/**
 * Checks whether a domain looks like a public internet domain reachable by
 * public favicon services (Google/DuckDuckGo). Private IPs, localhost and
 * single-word hostnames will always fail third-party lookups.
 */
export function isPublicDomain(domain: string): boolean {
	if (!domain || !domain.includes(".")) return false;
	if (/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(domain)) {
		return false;
	}
	if (/\.(local|internal|lan|home|test|example|invalid)$/i.test(domain)) {
		return false;
	}
	return true;
}

export function providerFaviconUrl(provider: Exclude<FaviconProvider, "site">, domain: string): string {
	const encoded = encodeURIComponent(domain);
	return provider === "duckduckgo"
		? `https://icons.duckduckgo.com/ip3/${encoded}.ico`
		: `https://www.google.com/s2/favicons?domain=${encoded}&sz=64`;
}

/**
 * Ordered list of favicon URLs to try. The renderer falls through the list on
 * `<img>` load errors and finally shows a sleek fallback link icon.
 */
export function faviconCandidates(
	url: string,
	metadata: LinkMetadata | undefined,
	provider: FaviconProvider,
): string[] {
	const domain = getHostname(url);
	const candidates: string[] = [];
	if (provider === "site" && metadata?.faviconUrl) candidates.push(metadata.faviconUrl);
	if (domain && isPublicDomain(domain)) {
		if (provider === "duckduckgo") {
			candidates.push(providerFaviconUrl("duckduckgo", domain));
			candidates.push(providerFaviconUrl("google", domain));
		} else {
			candidates.push(providerFaviconUrl("google", domain));
			candidates.push(providerFaviconUrl("duckduckgo", domain));
		}
	}
	return Array.from(new Set(candidates));
}
