import { NextRequest, NextResponse } from "next/server";
import { SearchInputSchema } from "@/lib/validations/restaurant";
import { isRateLimited } from "@/lib/rate-limit";
import { fetchCityCenter, fetchFromGoogle } from "@/lib/sources/google";
import { cacheGet, cacheSet } from "@/lib/cache";

// Structure of a cached result. Matches what we send to the client.
interface CachedSearch {
  restaurants: Awaited<ReturnType<typeof fetchFromGoogle>> extends { ok: true; restaurants: infer R }
    ? R
    : never;
  total: number;
}

function cacheKey(city: string, placeId?: string): string {
  // Normalize for locale + whitespace so equivalent user inputs share a
  // single cache entry: NFC unicode normalization, explicit en-US lowercase
  // (avoids the Turkish I/İ trap that default toLowerCase mis-handles), and
  // collapse any run of internal whitespace to a single space. A placeId,
  // when present, is appended so bounded and unbounded queries for the same
  // string land in different entries.
  const normalized = city
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
  return placeId ? `search:${normalized}:${placeId}` : `search:${normalized}`;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";

  if (isRateLimited(ip, { bucket: "search", maxRequests: 10 })) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GOOGLE_PLACES_API_KEY. Set it in .env.local and restart." },
      { status: 500 }
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

  const { city, placeId } = parsed.data;

  // Cache lookup: same normalized city + placeId within the TTL skips both
  // the Place Details call and the Text Search call entirely.
  const key = cacheKey(city, placeId);
  const cached = cacheGet<CachedSearch>(key);
  if (cached) {
    return NextResponse.json({ ...cached, source: "google", cached: true });
  }

  // When the client picked a city from autocomplete, resolve its center via
  // Place Details (cheapest "Location Only" SKU) so we can bound the search
  // to a 5-mile circle. Free-text searches without a placeId fall through
  // to an unbounded Text Search.
  let center: { lat: number; lng: number } | null = null;
  if (placeId) {
    center = await fetchCityCenter(placeId, apiKey);
  }

  const result = await fetchFromGoogle(city, apiKey, center);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { ok: _ok, ...data } = result;
  cacheSet(key, data);
  // Always emit `cached` so clients can check a single property instead of
  // treating `undefined` and `false` as equivalent.
  return NextResponse.json({ ...data, source: "google", cached: false });
}
