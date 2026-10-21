import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { LinkCache, type CacheStorage } from "../src/cache";
import { LinkMetadataService, type Fetcher } from "../src/metadataService";
import type { LinkMetadata } from "../src/types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 21);

class MemoryStorage implements CacheStorage {
	read = vi.fn(async () => this.data);
	write = vi.fn(async (data: string) => {
		this.data = data;
	});
	constructor(public data: string | null = null) {}
}

function cacheFile(entries: Record<string, LinkMetadata>): string {
	return JSON.stringify({ version: 1, entries });
}

async function setup(entries: Record<string, LinkMetadata> = {}, fetcher?: Fetcher, ttlDays = 30) {
	const storage = new MemoryStorage(Object.keys(entries).length ? cacheFile(entries) : null);
	const cache = new LinkCache(storage, 10);
	await cache.load();
	const fetchMock = vi.fn(
		fetcher ?? (async () => ({ ok: true as const, metadata: { title: "Fetched", fetchedAt: NOW } })),
	);
	const service = new LinkMetadataService(cache, { getTtlDays: () => ttlDays, fetcher: fetchMock, now: () => NOW });
	return { storage, cache, service, fetchMock };
}

describe("LinkCache", () => {
	afterEach(() => vi.useRealTimers());

	it("loads entries and reads them without writing", async () => {
		const { storage, cache } = await setup({ "https://a.com": { title: "A", fetchedAt: NOW - DAY } });
		for (let i = 0; i < 100; i++) expect(cache.get("https://a.com")?.title).toBe("A");
		await cache.flush();
		expect(storage.write).not.toHaveBeenCalled();
		expect(cache.isDirty).toBe(false);
	});

	it("ignores URL fragments for cache keys", async () => {
		const { cache } = await setup({ "https://a.com/x": { title: "A", fetchedAt: NOW } });
		expect(cache.get("https://a.com/x#heading")?.title).toBe("A");
	});

	it("computes freshness from the immutable fetchedAt", () => {
		const entry = { fetchedAt: NOW - 10 * DAY };
		expect(LinkCache.isFresh(entry, 30, NOW)).toBe(true);
		expect(LinkCache.isFresh(entry, 5, NOW)).toBe(false);
		expect(LinkCache.isFresh(entry, 0, NOW)).toBe(true); // 0 = never expires
	});

	it("debounces writes and serialises deterministically", async () => {
		vi.useFakeTimers();
		const storage = new MemoryStorage();
		const cache = new LinkCache(storage, 1000);
		cache.set("https://b.com", { title: "B", fetchedAt: 2 });
		cache.set("https://a.com", { fetchedAt: 1, description: "D", title: "A" });
		expect(storage.write).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(storage.write).toHaveBeenCalledTimes(1);
		const written = JSON.parse(storage.data as string);
		expect(Object.keys(written.entries)).toEqual(["https://a.com", "https://b.com"]);
		expect(Object.keys(written.entries["https://a.com"])).toEqual(["fetchedAt", "title", "description"]);
	});

	it("does not mark dirty when identical metadata is set again", async () => {
		const { storage, cache } = await setup({ "https://a.com": { title: "A", fetchedAt: NOW } });
		cache.set("https://a.com", { title: "A", fetchedAt: NOW });
		await cache.flush();
		expect(storage.write).not.toHaveBeenCalled();
	});

	it("survives a corrupt cache file without overwriting it", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const storage = new MemoryStorage("{not json");
		const cache = new LinkCache(storage, 10);
		await cache.load();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		expect(cache.size).toBe(0);
		await cache.flush();
		expect(storage.write).not.toHaveBeenCalled();
	});

	it("clear() empties the cache and writes immediately", async () => {
		const { storage, cache } = await setup({ "https://a.com": { title: "A", fetchedAt: NOW } });
		await cache.clear();
		expect(cache.size).toBe(0);
		expect(storage.write).toHaveBeenCalledTimes(1);
		expect(JSON.parse(storage.data as string).entries).toEqual({});
	});
});

describe("LinkMetadataService", () => {
	beforeEach(() => vi.mocked(requestUrl).mockReset());

	it("cache hit: renders synchronously, no fetch, no write", async () => {
		const { storage, cache, service, fetchMock } = await setup({
			"https://a.com": { title: "Cached", fetchedAt: NOW - DAY },
		});
		expect(service.get("https://a.com")?.title).toBe("Cached");
		service.request("https://a.com");
		service.request("https://a.com");
		await service.idle();
		await cache.flush();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(requestUrl).not.toHaveBeenCalled();
		expect(storage.write).not.toHaveBeenCalled();
	});

	it("cache miss: fetches once (deduplicated), notifies and writes once", async () => {
		const { storage, cache, service, fetchMock } = await setup();
		const listener = vi.fn();
		service.subscribe("https://new.com", listener);
		service.request("https://new.com");
		service.request("https://new.com");
		expect(service.isPending("https://new.com")).toBe(true);
		await service.idle();
		await cache.flush();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ title: "Fetched", fetchedAt: NOW });
		expect(storage.write).toHaveBeenCalledTimes(1);
		expect(service.get("https://new.com")?.title).toBe("Fetched");
	});

	it("expired entry: serves stale data, refreshes and writes", async () => {
		const { storage, cache, service, fetchMock } = await setup(
			{ "https://old.com": { title: "Old", fetchedAt: NOW - 40 * DAY } },
			undefined,
			30,
		);
		expect(service.get("https://old.com")?.title).toBe("Old");
		service.request("https://old.com");
		await service.idle();
		await cache.flush();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(service.get("https://old.com")).toEqual({ title: "Fetched", fetchedAt: NOW });
		expect(storage.write).toHaveBeenCalledTimes(1);
	});

	it("HTTP error: no write, stale data kept, no immediate retry", async () => {
		const failing: Fetcher = async () => ({ ok: false, status: 500, error: "HTTP 500" });
		const { storage, cache, service, fetchMock } = await setup(
			{ "https://old.com": { title: "Old", fetchedAt: NOW - 40 * DAY } },
			failing,
		);
		const listener = vi.fn();
		service.subscribe("https://old.com", listener);
		service.request("https://old.com");
		await service.idle();
		service.request("https://old.com"); // within cooldown
		await service.idle();
		await cache.flush();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(storage.write).not.toHaveBeenCalled();
		expect(service.get("https://old.com")?.title).toBe("Old");
		expect(listener).toHaveBeenCalledTimes(1); // placeholders leave loading state
	});

	it("limits concurrent fetches", async () => {
		let active = 0;
		let maxActive = 0;
		const slow: Fetcher = async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((r) => setTimeout(r, 5));
			active--;
			return { ok: true, metadata: { fetchedAt: NOW } };
		};
		const { service } = await setup({}, slow);
		for (let i = 0; i < 10; i++) service.request(`https://site${i}.com`);
		await service.idle();
		expect(maxActive).toBeLessThanOrEqual(4);
	});

	it("unsubscribe stops notifications", async () => {
		const { service } = await setup();
		const listener = vi.fn();
		const unsubscribe = service.subscribe("https://x.com", listener);
		unsubscribe();
		service.request("https://x.com");
		await service.idle();
		expect(listener).not.toHaveBeenCalled();
	});
});
