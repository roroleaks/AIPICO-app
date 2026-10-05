/**
 * Bounded TTL cache with least-recently-used eviction, plus single-flight request coalescing.
 *
 * Both exist for the same reason: PubMed queries from the same evidence-gap session repeat
 * constantly (retry, re-render, a second pass over the same PICO), and every repeat otherwise
 * costs an NCBI E-utilities call against a hard 3-requests-per-second anonymous budget. An
 * unbounded Map would be the wrong fix - clinician free text produces unbounded distinct keys,
 * so the cache needs a hard entry cap or a long-running server process leaks memory.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  // Map iteration order is insertion order, so re-inserting on read is what makes this LRU
  // rather than FIFO: the oldest key in iteration order is always the least recently used one.
  constructor(maxEntries: number, ttlMs: number, now: () => number = Date.now) {
    if (!Number.isFinite(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive number");
    }
    if (!Number.isFinite(ttlMs) || ttlMs < 1) {
      throw new Error("ttlMs must be a positive number");
    }
    this.maxEntries = Math.floor(maxEntries);
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, ttlMs: number = this.ttlMs): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      // `done` is only reachable if the map is empty, which the size check above prevents.
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Read-through helper so callers cannot forget the get-then-set pairing. */
  async wrap(key: string, load: () => Promise<T>, ttlMs?: number): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.set(key, value, ttlMs);
    return value;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Collapses concurrent identical work into one execution.
 *
 * Caching alone does not fix a burst: ten simultaneous requests for an uncached query all miss
 * at the same instant and all hit NCBI at once, which is exactly how a client trips the 429
 * limit. Sharing the in-flight promise makes burst size independent of upstream call count.
 */
export class SingleFlight<K, V> {
  private readonly inFlight = new Map<K, Promise<V>>();

  run(key: K, task: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    // The task is invoked from a microtask, not inline: an inline call runs its body up to the
    // first await synchronously, so a task that throws before awaiting would run `finally` before
    // the entry below was stored - deleting a key that was never set and then pinning the
    // rejected promise to the key forever.
    const started = Promise.resolve()
      .then(() => task())
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, started);
    return started;
  }

  get pending(): number {
    return this.inFlight.size;
  }
}