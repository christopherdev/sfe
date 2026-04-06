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
    if (status === 401) {
      return { ok: false, error: "Invalid Yelp API key", status: 401 };
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
  }));

  return { ok: true, restaurants, total: validated.data.total };
}
