/**
 * Git-friendly metadata cache persisted as `cache.json` in the plugin folder
 * (separate from the plugin settings in `data.json`).
 *
 * Write discipline:
 * - Reading (`get`, `isFresh`) NEVER schedules a disk write.
 * - Only `set()` (a successful new fetch / refresh of an expired entry) and
 *   `clear()` mark the cache dirty.
 * - `fetchedAt` is stored exactly once per successful fetch and never touched
 *   on access (no "last used" timestamps → no noisy Git diffs).
 * - Serialisation is deterministic (sorted keys) so diffs stay minimal.
 */
import type { LinkMetadata } from "./types";
import { normalizeUrl } from "./parser";

export interface CacheStorage {
	read(): Promise<string | null>;
	write(data: string): Promise<void>;
}

interface CacheFile {
	version: 1;
	entries: Record<string, LinkMetadata>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isValidEntry(value: unknown): value is LinkMetadata {
	if (!value || typeof value !== "object") return false;
	const entry = value as Record<string, unknown>;
	if (typeof entry.fetchedAt !== "number" || !Number.isFinite(entry.fetchedAt)) return false;
	return ["title", "description", "faviconUrl"].every(
		(key) => entry[key] === undefined || typeof entry[key] === "string",
	);
}

/** Copies only known fields in a fixed order (stable JSON output). */
function canonicalEntry(entry: LinkMetadata): LinkMetadata {
	const result: LinkMetadata = { fetchedAt: entry.fetchedAt };
	if (entry.title) result.title = entry.title;
	if (entry.description) result.description = entry.description;
	if (entry.faviconUrl) result.faviconUrl = entry.faviconUrl;
	return result;
}

export class LinkCache {
	private entries = new Map<string, LinkMetadata>();
	private dirty = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingWrite: Promise<void> = Promise.resolve();

	constructor(
		private readonly storage: CacheStorage,
		private readonly saveDelayMs = 2000,
	) {}

	get size(): number {
		return this.entries.size;
	}

	get isDirty(): boolean {
		return this.dirty;
	}

	async load(): Promise<void> {
		this.entries.clear();
		this.dirty = false;
		let raw: string | null = null;
		try {
			raw = await this.storage.read();
		} catch {
			raw = null;
		}
		if (!raw) return;
		try {
			const parsed = JSON.parse(raw) as Partial<CacheFile>;
			const entries = parsed?.entries ?? {};
			for (const [url, entry] of Object.entries(entries)) {
				if (isValidEntry(entry)) this.entries.set(url, canonicalEntry(entry));
			}
		} catch (error) {
			// Corrupt cache: start empty but do NOT overwrite the file until new data arrives.
			console.warn("[Smart Link Cards] Could not parse cache.json", error);
		}
	}

	/** Pure read – never triggers a write. */
	get(url: string): LinkMetadata | undefined {
		return this.entries.get(normalizeUrl(url));
	}

	has(url: string): boolean {
		return this.entries.has(normalizeUrl(url));
	}

	/** Whether an entry is still within its validity period. `ttlDays <= 0` = never expires. */
	static isFresh(entry: LinkMetadata, ttlDays: number, now: number = Date.now()): boolean {
		if (ttlDays <= 0) return true;
		return now - entry.fetchedAt < ttlDays * DAY_MS;
	}

	/** Stores freshly fetched metadata and schedules a (debounced) write. */
	set(url: string, metadata: LinkMetadata): void {
		const key = normalizeUrl(url);
		const entry = canonicalEntry(metadata);
		const existing = this.entries.get(key);
		if (existing && JSON.stringify(existing) === JSON.stringify(entry)) return;
		this.entries.set(key, entry);
		this.markDirty();
	}

	/** Removes all entries and writes immediately. */
	async clear(): Promise<void> {
		this.entries.clear();
		this.cancelTimer();
		this.dirty = true;
		await this.flush();
	}

	/** Writes to disk if (and only if) there are unsaved changes. */
	async flush(): Promise<void> {
		this.cancelTimer();
		if (!this.dirty) return this.pendingWrite;
		this.dirty = false;
		const data = this.serialize();
		this.pendingWrite = this.pendingWrite
			.catch(() => undefined)
			.then(() => this.storage.write(data))
			.catch((error) => {
				this.dirty = true;
				console.error("[Smart Link Cards] Could not write cache.json", error);
			});
		return this.pendingWrite;
	}

	serialize(): string {
		const entries: Record<string, LinkMetadata> = {};
		for (const key of Array.from(this.entries.keys()).sort()) {
			entries[key] = this.entries.get(key) as LinkMetadata;
		}
		const file: CacheFile = { version: 1, entries };
		return `${JSON.stringify(file, null, 2)}\n`;
	}

	dispose(): void {
		this.cancelTimer();
	}

	private markDirty(): void {
		this.dirty = true;
		this.cancelTimer();
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.flush();
		}, this.saveDelayMs);
	}

	private cancelTimer(): void {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}
}
