const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10; // per window per IP
const MAX_ENTRIES = 10_000; // cap to prevent unbounded growth

const requests = new Map<string, number[]>();

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = requests.get(ip) ?? [];
  const valid = timestamps.filter((t) => now - t < WINDOW_MS);

  if (valid.length >= MAX_REQUESTS) {
    requests.set(ip, valid);
    return true;
  }

  valid.push(now);
  requests.set(ip, valid);

  // Evict oldest entry if map grows too large
  if (requests.size > MAX_ENTRIES) {
    const firstKey = requests.keys().next().value;
    if (firstKey !== undefined) requests.delete(firstKey);
  }

  return false;
}
