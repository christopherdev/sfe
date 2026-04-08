import {
  GooglePlacesResponseSchema,
  type Restaurant,
} from "@/lib/validations/restaurant";

const GOOGLE_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GOOGLE_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";
// Google Places (New) caps pageSize at 20, which matches our result limit,
// so no pagination is needed.
const MAX_RESULTS = 20;
// 5 miles in meters — the required radius for "within city / 5-mile" relevance.
const SEARCH_RADIUS_METERS = 8047;

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.rating",
  "places.location",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
].join(",");

export type GoogleResult =
  | { ok: true; restaurants: Restaurant[]; total: number }
  | { ok: false; error: string; status: number };

// Resolve a Place Id (from an Autocomplete pick) to its lat/lng. Uses the
// "Location Only" field mask so this call falls into the cheapest Place
// Details SKU (~$5/1k). Returns null on any failure — callers fall back to
// unbounded search.
export async function fetchCityCenter(
  placeId: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = `${GOOGLE_PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "location",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const lat = data?.location?.latitude;
    const lng = data?.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function fetchFromGoogle(
  city: string,
  apiKey: string,
  center?: { lat: number; lng: number } | null,
): Promise<GoogleResult> {
  // Two endpoints, one normalizer. When we know the city's center, use
  // Nearby Search with a circular hard bound (5 miles) — its
  // locationRestriction accepts a circle natively. Text Search only accepts
  // rectangles for hard bounds, so for the free-text fallback (no center)
  // we just use Text Search with no region filter.
  const url = center ? GOOGLE_SEARCH_NEARBY_URL : GOOGLE_SEARCH_TEXT_URL;
  const body: Record<string, unknown> = center
    ? {
        includedTypes: ["restaurant"],
        maxResultCount: MAX_RESULTS,
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: SEARCH_RADIUS_METERS,
          },
        },
      }
    : {
        textQuery: `restaurants in ${city}`,
        pageSize: MAX_RESULTS,
      };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const status = response.status;
    const errBody = await response.json().catch(() => null);
    const apiStatus: string | undefined = errBody?.error?.status;

    const isAuthError =
      status === 401 ||
      status === 403 ||
      apiStatus === "PERMISSION_DENIED" ||
      apiStatus === "UNAUTHENTICATED";

    if (isAuthError) {
      return { ok: false, error: "Invalid Google API key. Check your key and try again.", status: 401 };
    }
    if (status === 400) {
      return { ok: false, error: "Could not process that city. Check the spelling and try again.", status: 400 };
    }
    if (status === 429) {
      return { ok: false, error: "Google API rate limit exceeded. Try again later.", status: 429 };
    }
    return { ok: false, error: "Google API is unavailable. Try again later.", status: 502 };
  }

  const data = await response.json();
  const validated = GooglePlacesResponseSchema.safeParse(data);
  if (!validated.success) {
    return { ok: false, error: "Unexpected response from Google API", status: 502 };
  }

  const restaurants: Restaurant[] = validated.data.places.map((p) => ({
    id: `google-${p.id}`,
    name: p.displayName.text,
    rating: p.rating ?? null,
    coordinates: {
      latitude: p.location.latitude,
      longitude: p.location.longitude,
    },
    address: p.formattedAddress ?? "",
    source: "google",
    cuisine: null,
    phone: p.nationalPhoneNumber ?? null,
    // Canonical Google Places id for deep-linking. Lets UI code skip the
    // "slice off the `google-` prefix" dance.
    placeId: p.id,
  }));

  return { ok: true, restaurants, total: restaurants.length };
}
