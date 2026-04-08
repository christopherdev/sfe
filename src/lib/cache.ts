// In-memory LRU-ish cache with TTL. Per-process — in a multi-replica deploy
// each replica has its own. Good enough to cut Google Places costs for
// popular searches in a single-instance setup.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  // Touch LRU order so this entry is treated as most-recently-used.
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

export function cacheSet<T>(
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (store.size > MAX_ENTRIES) {
    // Evict the least-recently-used entry (first insertion order).
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
}
