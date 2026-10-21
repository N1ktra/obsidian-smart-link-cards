import { describe, expect, it } from "vitest";
import { needsMetadata, prettyUrl, resolveDisplay, type LinkDescriptor } from "../src/display";
import { faviconCandidates, getHostname } from "../src/favicon";
import { DEFAULT_SETTINGS } from "../src/settings";

const settings = { ...DEFAULT_SETTINGS };

describe("resolveDisplay", () => {
	const bare: LinkDescriptor = { url: "https://www.github.com/foo/", syntax: "bare", overrides: {} };

	it("uses crawled metadata for bare URLs", () => {
		const d = resolveDisplay(bare, "block", { title: "Foo", description: "Bar", fetchedAt: 1 }, settings);
		expect(d).toMatchObject({ title: "Foo", description: "Bar", hostname: "github.com", loading: false, isManualDescription: false });
		expect(d.iconCandidates[0]).toBe("https://www.google.com/s2/favicons?domain=github.com&sz=64");
	});

	it("falls back to a pretty URL while loading", () => {
		const d = resolveDisplay(bare, "block", undefined, settings);
		expect(d).toMatchObject({ title: "github.com/foo", loading: true });
	});

	it("manual overrides beat crawled data", () => {
		const link: LinkDescriptor = {
			url: "https://portal.uni.de",
			syntax: "markdown",
			overrides: { title: "Portal", description: "Manual", icon: { type: "emoji", value: "🎓" } },
		};
		const d = resolveDisplay(link, "block", { title: "Login", description: "Bot check", fetchedAt: 1 }, settings);
		expect(d).toMatchObject({ title: "Portal", description: "Manual", emoji: "🎓", isManualDescription: true });
		expect(needsMetadata(link, "block", settings)).toBe(false);
	});

	it("puts a manual icon URL first", () => {
		const link: LinkDescriptor = {
			url: "https://a.com",
			syntax: "markdown",
			overrides: { icon: { type: "url", value: "https://a.com/i.png" } },
		};
		expect(resolveDisplay(link, "inline", undefined, settings).iconCandidates[0]).toBe("https://a.com/i.png");
	});

	it("inline markdown links need no fetch with the google provider", () => {
		const link: LinkDescriptor = { url: "https://a.com", syntax: "markdown", overrides: { title: "A" } };
		expect(needsMetadata(link, "inline", settings)).toBe(false);
		expect(needsMetadata(link, "inline", { ...settings, faviconProvider: "site" })).toBe(true);
		expect(needsMetadata(bare, "inline", settings)).toBe(true);
		expect(needsMetadata(bare, "inline", { ...settings, showTitleForBareInlineUrls: false })).toBe(false);
	});

	it("respects inline pill description needsMetadata", () => {
		const link: LinkDescriptor = { url: "https://a.com", syntax: "markdown", overrides: { title: "A" } };
		expect(needsMetadata(link, "inline", { ...settings, showDescriptionInInlinePills: true })).toBe(true);
		const manualLink: LinkDescriptor = { url: "https://a.com", syntax: "markdown", overrides: { title: "A", description: "M" } };
		expect(needsMetadata(manualLink, "inline", { ...settings, showDescriptionInInlinePills: true })).toBe(false);
	});
});

describe("favicons", () => {
	it("orders candidates by provider", () => {
		const meta = { faviconUrl: "https://a.com/fav.ico", fetchedAt: 1 };
		expect(faviconCandidates("https://a.com", meta, "site")[0]).toBe("https://a.com/fav.ico");
		expect(faviconCandidates("https://a.com", meta, "duckduckgo")[0]).toBe("https://icons.duckduckgo.com/ip3/a.com.ico");
		expect(faviconCandidates("https://a.com", meta, "google")).not.toContain("https://a.com/fav.ico");
	});

	it("extracts hostnames", () => {
		expect(getHostname("https://www.example.com:8080/x")).toBe("example.com");
		expect(getHostname("not a url")).toBe("");
	});

	it("shortens URLs", () => {
		expect(prettyUrl("https://www.example.com/")).toBe("example.com");
		expect(prettyUrl(`https://a.com/${"x".repeat(100)}`, 20)).toHaveLength(20);
	});
});
