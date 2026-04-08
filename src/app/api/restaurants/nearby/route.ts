import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRateLimited } from "@/lib/rate-limit";
import { fetchFromOverpassByCoords } from "@/lib/sources/overpass";

const NearbyInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Hard-cap at 10 km so an unauthenticated caller can't ask for a 25 km
  // sweep over a dense metro and blow out Overpass (timeouts + rate-limit).
  radiusKm: z.number().min(0.1).max(10),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip, { bucket: "nearby", maxRequests: 20 })) {
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

  const parsed = NearbyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const result = await fetchFromOverpassByCoords(
    parsed.data.lat,
    parsed.data.lng,
    parsed.data.radiusKm
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { ok: _ok, ...data } = result;
  // `source` appears twice in the wire format — once per-record on each
  // restaurant (set by the upstream fetcher for provenance) and once at the
  // envelope level here as response metadata. Kept for parity with the
  // /api/restaurants route.
  return NextResponse.json({ ...data, source: "openstreetmap" });
}
