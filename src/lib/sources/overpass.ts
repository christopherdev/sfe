import {
  OverpassResponseSchema,
  NominatimResponseSchema,
  type Restaurant,
} from "@/lib/validations/restaurant";

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MAX_RESULTS = 20;
const MIRROR_TIMEOUT_MS = 8000;

interface GeoResult {
  bbox: [string, string, string, string];
  displayName: string;
}

interface GeoError {
  error: string;
}

async function geocodeCity(city: string): Promise<GeoResult | GeoError | null> {
  const params = new URLSearchParams({
    q: city,
    format: "json",
    limit: "1",
    addressdetails: "0",
    countrycodes: "us",
  });

  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "User-Agent": "RestaurantSearch/1.0" },
  });

  if (!response.ok) return null;

  const results = await response.json();
  const validated = NominatimResponseSchema.safeParse(results);

  if (!validated.success) return null;

  const result = validated.data[0];

  if (result.place_rank < 12) {
    return { error: `"${result.display_name}" is too broad. Please enter a city name.` };
  }

  return {
    bbox: result.boundingbox,
    displayName: result.display_name,
  };
}

export type OverpassResult =
  | { ok: true; restaurants: Restaurant[]; total: number; resolvedLocation: string }
  | { ok: false; error: string; status: number };

export async function fetchFromOverpass(city: string): Promise<OverpassResult> {
  const geo = await geocodeCity(city);

  if (!geo) {
    return { ok: false, error: "Could not find that location. Check the spelling and try again.", status: 400 };
  }

  if ("error" in geo) {
    return { ok: false, error: geo.error, status: 400 };
  }

  const [south, north, west, east] = geo.bbox;

  const query = `[out:json][timeout:25];
node["amenity"="restaurant"](${south},${west},${north},${east});
out 40;`;

  let text: string | null = null;
  let allMirrorsBusy = true;

  for (const mirrorUrl of OVERPASS_MIRRORS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);

    try {
      const response = await fetch(mirrorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": "RestaurantSearch/1.0",
        },
        body: query,
        signal: controller.signal,
      });
      const responseText = await response.text();
      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") ?? "";

      if (response.ok && contentType.includes("application/json")) {
        text = responseText;
        break;
      }

      if (
        response.status === 503 ||
        response.status === 504 ||
        responseText.includes("too busy") ||
        responseText.includes("timeout")
      ) {
        continue;
      }

      allMirrorsBusy = false;
      break;
    } catch {
      // Network error, abort timeout, DNS, TLS — treat as unhealthy mirror, try next
      clearTimeout(timeoutId);
      continue;
    }
  }

  if (text === null) {
    return allMirrorsBusy
      ? { ok: false, error: "OpenStreetMap is busy. Please try again in a few seconds.", status: 503 }
      : { ok: false, error: "Failed to fetch from OpenStreetMap. Try again.", status: 502 };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid response from OpenStreetMap", status: 502 };
  }

  const validated = OverpassResponseSchema.safeParse(data);

  if (!validated.success) {
    return { ok: false, error: "Unexpected response from OpenStreetMap", status: 502 };
  }

  const restaurants: Restaurant[] = validated.data.elements
    .filter((el): el is typeof el & { tags: NonNullable<typeof el.tags> & { name: string } } =>
      typeof el.tags?.name === "string" &&
      ((el.lat != null && el.lon != null) || el.center != null)
    )
    .map((el) => {
      const lat = el.lat ?? el.center!.lat;
      const lon = el.lon ?? el.center!.lon;

      const parts = [
        el.tags["addr:housenumber"],
        el.tags["addr:street"],
        el.tags["addr:city"],
        el.tags["addr:state"],
        el.tags["addr:postcode"],
      ].filter(Boolean);

      return parts.length > 0
        ? {
            id: `osm-${el.type}-${el.id}`,
            name: el.tags.name,
            rating: null,
            coordinates: { latitude: lat, longitude: lon },
            address: parts.join(", "),
            source: "openstreetmap" as const,
            cuisine: el.tags.cuisine ?? null,
            phone: el.tags.phone ?? null,
          }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .slice(0, MAX_RESULTS);

  return { ok: true, restaurants, total: restaurants.length, resolvedLocation: geo.displayName };
}
