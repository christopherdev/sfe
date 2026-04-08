import {
  GooglePlacesResponseSchema,
  type Restaurant,
} from "@/lib/validations/restaurant";

const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const MAX_RESULTS = 20;
// 5 miles in meters — per the project requirements doc ("within city limits
// or 5-mile radius").
const RADIUS_METERS = 8047;

const RESTAURANT_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.rating",
  "places.location",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
].join(",");

export interface GoogleSuccess {
  ok: true;
  restaurants: Restaurant[];
  total: number;
  resolvedLocation: string;
}

export interface GoogleFailure {
  ok: false;
  error: string;
  status: number;
}

export type GoogleResult = GoogleSuccess | GoogleFailure;

// User-facing messages. Auth failures get a generic "temporarily unavailable"
// — end users can't fix a bad server key. The actual reason is logged
// server-side for ops.
function mapPlacesError(status: number, apiStatus?: string): GoogleFailure {
  const isAuthError =
    status === 401 ||
    status === 403 ||
    apiStatus === "PERMISSION_DENIED" ||
    apiStatus === "UNAUTHENTICATED";
  if (isAuthError) {
    return { ok: false, error: "Search is temporarily unavailable. Please try again later.", status: 503 };
  }
  if (status === 400) {
    return { ok: false, error: "Could not process that city. Check the spelling and try again.", status: 400 };
  }
  if (status === 429) {
    return { ok: false, error: "Too many searches right now. Please try again in a moment.", status: 429 };
  }
  return { ok: false, error: "Search is temporarily unavailable. Please try again later.", status: 503 };
}

// Step 1: resolve a city name to lat/lng + canonical formatted name. Uses
// places:searchText with the cheapest possible field mask (location only)
// since the only thing we need from this call is coordinates we can hand
// to the bounded searchNearby call.
//
// We stay on the Places API for this so the same key works — switching to
// the dedicated Geocoding API would be cheaper per call but requires
// enabling and authorizing a separate SKU on the GCP project.
async function findCityCenter(
  city: string,
  apiKey: string,
): Promise<
  | { ok: true; lat: number; lng: number; formatted: string }
  | GoogleFailure
> {
  const response = await fetch(SEARCH_TEXT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // We only need the location and the formatted name — keeps the SKU tier low.
      "X-Goog-FieldMask": "places.location,places.formattedAddress",
    },
    body: JSON.stringify({
      textQuery: city,
      maxResultCount: 1,
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    const apiStatus: string | undefined = errBody?.error?.status;
    console.error(`[findCityCenter] HTTP ${response.status} apiStatus=${apiStatus} city="${city}"`);
    return mapPlacesError(response.status, apiStatus);
  }

  const data = await response.json();
  const top = data?.places?.[0];
  const lat = top?.location?.latitude;
  const lng = top?.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { ok: false, error: "Could not find that city. Check the spelling and try again.", status: 400 };
  }
  return {
    ok: true,
    lat,
    lng,
    formatted: typeof top.formattedAddress === "string" ? top.formattedAddress : city,
  };
}

export async function fetchFromGoogle(city: string, apiKey: string): Promise<GoogleResult> {
  // Step 1: resolve city → coordinates.
  const geo = await findCityCenter(city, apiKey);
  if (!geo.ok) return geo;

  // Step 2: fetch restaurants strictly within 5 miles of that point.
  // searchNearby's locationRestriction with a circle is a HARD bound —
  // results outside the circle are excluded.
  const response = await fetch(SEARCH_NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": RESTAURANT_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ["restaurant"],
      maxResultCount: MAX_RESULTS,
      locationRestriction: {
        circle: {
          center: { latitude: geo.lat, longitude: geo.lng },
          radius: RADIUS_METERS,
        },
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    const apiStatus: string | undefined = errBody?.error?.status;
    console.error(`[searchNearby] HTTP ${response.status} apiStatus=${apiStatus}`);
    return mapPlacesError(response.status, apiStatus);
  }

  const data = await response.json();
  const validated = GooglePlacesResponseSchema.safeParse(data);
  if (!validated.success) {
    console.error(`[searchNearby] unexpected payload`);
    return { ok: false, error: "Search is temporarily unavailable. Please try again later.", status: 503 };
  }

  const restaurants: Restaurant[] = validated.data.places.map((p) => ({
    id: p.id,
    name: p.displayName.text,
    rating: p.rating ?? null,
    coordinates: {
      latitude: p.location.latitude,
      longitude: p.location.longitude,
    },
    address: p.formattedAddress ?? "",
    cuisine: null,
    phone: p.nationalPhoneNumber ?? null,
  }));

  return {
    ok: true,
    restaurants,
    total: restaurants.length,
    resolvedLocation: geo.formatted,
  };
}
