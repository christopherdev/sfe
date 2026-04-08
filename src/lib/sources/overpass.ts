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

type OverpassRunResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status: number };

// Executes an Overpass QL query against the mirror list with per-mirror
// timeouts and distinguishes "busy" from "hard error" responses.
async function runOverpassQuery(query: string): Promise<OverpassRunResult> {
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

  return { ok: true, text };
}

// Parses an Overpass JSON response body into unified Restaurant objects.
// Returns null when the payload isn't valid JSON or doesn't match the schema.
function parseRestaurants(text: string): Restaurant[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  const validated = OverpassResponseSchema.safeParse(data);
  if (!validated.success) return null;

  // Accept any node with a name and coordinates. OSM data is sparse — many
  // legitimate POIs have a name, lat/lng and cuisine but no structured
  // addr:* tags. Requiring a full address block shrinks the result set to
  // nothing in smaller cities.
  return validated.data.elements
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

      return {
        id: `osm-${el.type}-${el.id}`,
        name: el.tags.name,
        rating: null,
        coordinates: { latitude: lat, longitude: lon },
        address: parts.join(", "),
        source: "openstreetmap" as const,
        cuisine: el.tags.cuisine ?? null,
        phone: el.tags.phone ?? null,
        // Overpass has no external provider id equivalent.
        placeId: null,
      };
    })
    .slice(0, MAX_RESULTS);
}

export async function fetchFromOverpass(city: string): Promise<OverpassResult> {
  const geo = await geocodeCity(city);

  if (!geo) {
    return { ok: false, error: "Could not find that location. Check the spelling and try again.", status: 400 };
  }

  if ("error" in geo) {
    return { ok: false, error: geo.error, status: 400 };
  }

  const [south, north, west, east] = geo.bbox;

  // Fetch ~1.5× MAX_RESULTS so parseRestaurants can drop unnamed/address-less
  // nodes and still fill the grid. Capped to MAX_RESULTS downstream.
  const query = `[out:json][timeout:25];
node["amenity"="restaurant"](${south},${west},${north},${east});
out 30;`;

  const run = await runOverpassQuery(query);
  if (!run.ok) return run;

  const restaurants = parseRestaurants(run.text);
  if (restaurants === null) {
    return { ok: false, error: "Unexpected response from OpenStreetMap", status: 502 };
  }

  return { ok: true, restaurants, total: restaurants.length, resolvedLocation: geo.displayName };
}

// Fetches restaurants within `radiusKm` of the given coordinates using
// Overpass's `around:` filter. No geocoding needed.
export async function fetchFromOverpassByCoords(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<OverpassResult> {
  const radiusMeters = Math.round(radiusKm * 1000);
  // Same ~1.5× MAX_RESULTS hedge as the city-search path. Downstream
  // parseRestaurants drops nodes without a name/address and slices to MAX.
  const query = `[out:json][timeout:25];
node["amenity"="restaurant"](around:${radiusMeters},${lat},${lng});
out 30;`;

  const run = await runOverpassQuery(query);
  if (!run.ok) return run;

  const restaurants = parseRestaurants(run.text);
  if (restaurants === null) {
    return { ok: false, error: "Unexpected response from OpenStreetMap", status: 502 };
  }

  return {
    ok: true,
    restaurants,
    total: restaurants.length,
    resolvedLocation: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
}
