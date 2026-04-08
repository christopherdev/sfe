const WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 10; // per window per IP
const MAX_ENTRIES = 10_000; // cap to prevent unbounded growth

const requests = new Map<string, number[]>();

interface RateLimitOptions {
  bucket?: string;
  maxRequests?: number;
}

export function isRateLimited(ip: string, options: RateLimitOptions = {}): boolean {
  const bucket = options.bucket ?? "default";
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const key = `${bucket}:${ip}`;

  const now = Date.now();
  const timestamps = requests.get(key) ?? [];
  const valid = timestamps.filter((t) => now - t < WINDOW_MS);

  if (valid.length >= maxRequests) {
    requests.set(key, valid);
    return true;
  }

  valid.push(now);
  requests.set(key, valid);

  // Evict oldest entry if map grows too large
  if (requests.size > MAX_ENTRIES) {
    const firstKey = requests.keys().next().value;
    if (firstKey !== undefined) requests.delete(firstKey);
  }

  return false;
}
