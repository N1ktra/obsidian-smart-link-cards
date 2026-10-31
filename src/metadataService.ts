/**
 * Orchestrates cache lookups, background fetches and change notifications.
 */
import { LinkCache } from "./cache";
import { fetchLinkMetadata, type FetchResult } from "./fetcher";
import { normalizeUrl } from "./parser";
import type { LinkMetadata } from "./types";

export type Fetcher = (url: string) => Promise<FetchResult>;
export type MetadataListener = (metadata: LinkMetadata | undefined) => void;

export interface MetadataServiceOptions {
	getTtlDays: () => number;
	fetcher?: Fetcher;
	now?: () => number;
	maxConcurrent?: number;
	/** How long a failed URL is not retried (in-memory only, never persisted). */
	failureCooldownMs?: number;
}

export class LinkMetadataService {
	private readonly listeners = new Map<string, Set<MetadataListener>>();
	private readonly inFlight = new Set<string>();
	private readonly queue: string[] = [];
	private readonly failures = new Map<string, number>();
	private active = 0;
	private readonly fetcher: Fetcher;
	private readonly now: () => number;
	private readonly maxConcurrent: number;
	private readonly failureCooldownMs: number;

	constructor(
		private readonly cache: LinkCache,
		private readonly options: MetadataServiceOptions,
	) {
		this.fetcher = options.fetcher ?? ((url) => fetchLinkMetadata(url, this.now()));
		this.now = options.now ?? (() => Date.now());
		this.maxConcurrent = options.maxConcurrent ?? 4;
		this.failureCooldownMs = options.failureCooldownMs ?? 10 * 60 * 1000;
	}

	/** Synchronous cache read (stale entries are returned too). Never writes. */
	get(url: string): LinkMetadata | undefined {
		return this.cache.get(url);
	}

	isFresh(url: string): boolean {
		const entry = this.cache.get(url);
		return !!entry && LinkCache.isFresh(entry, this.options.getTtlDays(), this.now());
	}

	/** Whether a fetch for this URL is queued or running. */
	isPending(url: string): boolean {
		return this.inFlight.has(normalizeUrl(url));
	}

	/**
	 * Ensures metadata for the URL is available. Does nothing for fresh cache
	 * hits unless force=true; otherwise schedules a background fetch (deduplicated, rate-limited).
	 */
	request(url: string, force = false): void {
		const key = normalizeUrl(url);
		if (!force && this.isFresh(key)) return;
		if (this.inFlight.has(key)) return;
		const failedAt = this.failures.get(key);
		if (!force && failedAt !== undefined && this.now() - failedAt < this.failureCooldownMs) return;
		this.failures.delete(key);
		this.inFlight.add(key);
		this.queue.push(url.trim());
		this.pump();
	}

	subscribe(url: string, listener: MetadataListener): () => void {
		const key = normalizeUrl(url);
		let set = this.listeners.get(key);
		if (!set) {
			set = new Set();
			this.listeners.set(key, set);
		}
		set.add(listener);
		return () => {
			set?.delete(listener);
			if (set && set.size === 0) this.listeners.delete(key);
		};
	}

	/** Resets in-memory state (used after clearing the cache). */
	reset(): void {
		this.failures.clear();
		for (const key of this.listeners.keys()) this.notify(key);
	}

	/** Resolves when all queued fetches are done (useful for tests). */
	async idle(): Promise<void> {
		while (this.active > 0 || this.queue.length > 0) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	private pump(): void {
		while (this.active < this.maxConcurrent && this.queue.length > 0) {
			const url = this.queue.shift() as string;
			this.active++;
			void this.run(url).finally(() => {
				this.active--;
				this.pump();
			});
		}
	}

	private async run(url: string): Promise<void> {
		const key = normalizeUrl(url);
		let result: FetchResult;
		try {
			result = await this.fetcher(url);
		} catch (error) {
			result = { ok: false, error: String(error) };
		}
		this.inFlight.delete(key);
		if (result.ok) {
			this.failures.delete(key);
			this.cache.set(key, result.metadata);
		} else {
			// Failures are remembered in memory only – nothing is written to disk.
			this.failures.set(key, this.now());
		}
		// Notify in both cases so placeholders leave their loading state.
		this.notify(key);
	}

	private notify(key: string): void {
		const metadata = this.cache.get(key);
		for (const listener of Array.from(this.listeners.get(key) ?? [])) {
			try {
				listener(metadata);
			} catch (error) {
				console.error("[Smart Link Cards] listener failed", error);
			}
		}
	}
}
