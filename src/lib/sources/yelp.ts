import {
  YelpResponseSchema,
  type Restaurant,
} from "@/lib/validations/restaurant";

const YELP_API_URL = "https://api.yelp.com/v3/businesses/search";
const FIVE_MILES_IN_METERS = "8045";

export type YelpResult =
  | { ok: true; restaurants: Restaurant[]; total: number }
  | { ok: false; error: string; status: number };

export async function fetchFromYelp(city: string, apiKey: string): Promise<YelpResult> {
  const params = new URLSearchParams({
    location: city,
    term: "restaurants",
    limit: "20",
    sort_by: "best_match",
    radius: FIVE_MILES_IN_METERS,
  });

  const response = await fetch(`${YELP_API_URL}?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const status = response.status;
    const body = await response.json().catch(() => null);
    const code = body?.error?.code;

    const isAuthError =
      status === 401 ||
      status === 403 ||
      code === "TOKEN_INVALID" ||
      code === "TOKEN_MISSING" ||
      body?.error?.field === "Authorization";

    if (isAuthError) {
      return { ok: false, error: "Invalid Yelp API key. Check your key and try again.", status: 401 };
    }
    if (status === 400) {
      return { ok: false, error: "Could not find that city. Check the spelling and try again.", status: 400 };
    }
    return { ok: false, error: "Yelp API is unavailable. Try again later.", status: 502 };
  }

  const data = await response.json();
  const validated = YelpResponseSchema.safeParse(data);

  if (!validated.success) {
    return { ok: false, error: "Unexpected response from Yelp API", status: 502 };
  }

  const restaurants: Restaurant[] = validated.data.businesses.map((b) => ({
    id: b.id,
    name: b.name,
    rating: b.rating,
    coordinates: b.coordinates,
    address: b.location.display_address.join(", "),
    source: "yelp",
    cuisine: null,
    phone: b.phone ?? null,
    // Yelp uses the business id itself as the deep-link handle.
    placeId: b.id,
  }));

  return { ok: true, restaurants, total: validated.data.total };
}
