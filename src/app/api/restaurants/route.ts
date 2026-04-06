import { NextRequest, NextResponse } from "next/server";
import { SearchInputSchema } from "@/lib/validations/restaurant";
import { isRateLimited } from "@/lib/rate-limit";
import { fetchFromYelp } from "@/lib/sources/yelp";
import { fetchFromOverpass } from "@/lib/sources/overpass";

export async function POST(request: NextRequest) {
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

  const { city, apiKey } = parsed.data;
  const result = apiKey
    ? await fetchFromYelp(city, apiKey)
    : await fetchFromOverpass(city);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { ok: _, ...data } = result;
  return NextResponse.json({ ...data, source: apiKey ? "yelp" : "openstreetmap" });
}
