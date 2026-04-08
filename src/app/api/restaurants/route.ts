import { NextRequest, NextResponse } from "next/server";
import { SearchInputSchema } from "@/lib/validations/restaurant";
import { isRateLimited } from "@/lib/rate-limit";
import { fetchFromGoogle, type GoogleSuccess } from "@/lib/sources/google";
import { cacheGet, cacheSet } from "@/lib/cache";

// Cached shape — just the data we want to send on subsequent cache hits.
type CachedSearch = Pick<GoogleSuccess, "restaurants" | "total" | "resolvedLocation">;

// Normalize a city string for cache keying: NFC unicode, locale-aware
// lowercase (avoids the Turkish I trap), collapsed whitespace. Without
// this, "San  Francisco" and "san francisco" would be different keys.
function cacheKey(city: string): string {
  const normalized = city
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
  return `search:${normalized}`;
}

export async function POST(request: NextRequest) {
  // Config error check FIRST — a missing env var is a server bug, not abuse,
  // and shouldn't eat the caller's rate-limit budget.
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GOOGLE_PLACES_API_KEY. Set it in .env.local and restart." },
      { status: 500 }
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = SearchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { city } = parsed.data;

  // Cache lookup: same normalized city within the 24h TTL skips both
  // the Geocoding call AND the Nearby Search call entirely.
  const key = cacheKey(city);
  const cached = cacheGet<CachedSearch>(key);
  if (cached) {
    return NextResponse.json({ ...cached, source: "google" });
  }

  const result = await fetchFromGoogle(city, apiKey);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const payload: CachedSearch = {
    restaurants: result.restaurants,
    total: result.total,
    resolvedLocation: result.resolvedLocation,
  };
  cacheSet(key, payload);
  return NextResponse.json({ ...payload, source: "google" });
}
