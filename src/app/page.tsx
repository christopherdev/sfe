"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ApiResponseSchema, type ApiResponse } from "@/lib/validations/restaurant";
import type { MapRestaurant } from "./_components/MapBackground";

// Google Maps JS API can't render on the server — load the map only on the
// client. The `loading` fallback is what Next sends during SSR and on the
// client before the chunk arrives.
const MapBackground = dynamic(() => import("./_components/MapBackground"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-stone-950" />,
});

interface Suggestion {
  placeId: string;
  text: string;
  main: string;
  secondary: string;
}

const NEARBY_RADIUS_KM = 5;

type GeoStatus = "idle" | "pending" | "granted" | "denied" | "unsupported";

function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function Home() {
  const [city, setCity] = useState("");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchedCity, setSearchedCity] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Tracks the text we suppress suggestions for (e.g. right after a pick)
  const suppressedInputRef = useRef<string | null>(null);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [nearbyRestaurants, setNearbyRestaurants] = useState<ApiResponse["restaurants"]>([]);
  // The card the user has picked: shown in a floating detail panel, focused on
  // the map, and used as the center point for "near this restaurant" highlights.
  const [selected, setSelected] = useState<ApiResponse["restaurants"][number] | null>(null);

  // Esc closes the detail panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ask the browser for the user's location once on mount.
  // Non-blocking: search works fine whether this resolves, fails, or is denied.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("unsupported");
      return;
    }
    setGeoStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("granted");
      },
      () => {
        setGeoStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  // Once we have the user's coordinates, fetch nearby restaurants from the
  // free Overpass-backed endpoint to populate the map background.
  useEffect(() => {
    if (!userLocation) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/restaurants/nearby", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: userLocation.lat,
            lng: userLocation.lng,
            radiusKm: NEARBY_RADIUS_KM,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as unknown;
        const parsed = ApiResponseSchema.safeParse(data);
        if (!parsed.success) return;
        setNearbyRestaurants(parsed.data.restaurants);
      } catch {
        // Aborts land here too. Non-fatal — the map just won't have pins.
      }
    })();
    return () => controller.abort();
  }, [userLocation]);

  // Debounced fetch of autocomplete suggestions as the user types. Each effect
  // run owns an AbortController so a slow in-flight request can't land after
  // the next typed character and overwrite the newer suggestion list.
  useEffect(() => {
    const input = city.trim();
    if (input.length < 2) {
      setSuggestions([]);
      setActiveIndex(-1);
      return;
    }
    if (suppressedInputRef.current === input) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions?: Suggestion[] };
        setSuggestions(data.suggestions ?? []);
        setShowSuggestions(true);
        setActiveIndex(-1);
      } catch {
        // Aborts land here too — silently ignore.
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [city]);

  function pickSuggestion(s: Suggestion) {
    // runSearch handles the rest of the state resets (suggestions list,
    // dropdown visibility, etc). Only things it doesn't touch are handled here.
    // Forward the suggestion's placeId so the server can bound results to
    // a 5-mile circle around the picked city's center.
    suppressedInputRef.current = s.text;
    setCity(s.text);
    runSearch(s.text, s.placeId);
  }

  async function runSearch(rawCity: string, placeId?: string) {
    const trimmedCity = rawCity.trim();
    if (!trimmedCity) return;
    setError("");
    setResult(null);
    // Clear any active selection synchronously here, rather than via a reactive
    // effect on `result`, so the imperative flow is easy to follow.
    setSelected(null);
    setLoading(true);
    setSearchedCity(trimmedCity);
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);

    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          placeId ? { city: trimmedCity, placeId } : { city: trimmedCity },
        ),
      });

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        setError("Received an invalid response from the server.");
        return;
      }

      if (!res.ok) {
        const body = data as Record<string, unknown>;
        setError((body.error as string) || "Something went wrong");
        return;
      }

      const parsed = ApiResponseSchema.safeParse(data);

      if (!parsed.success) {
        setError("Received unexpected data from the server.");
        return;
      }

      setResult(parsed.data);
      if (parsed.data.resolvedLocation) {
        setSearchedCity(parsed.data.resolvedLocation);
      }
    } catch {
      setError("Failed to connect. Check your network and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (showSuggestions && activeIndex >= 0 && suggestions[activeIndex]) {
      pickSuggestion(suggestions[activeIndex]);
      return;
    }
    runSearch(city);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  }

  const total = result?.total ?? 0;
  const hasSearched = searchedCity !== "" && !loading;

  // Annotate each restaurant with its distance from the user (if known),
  // and sort nearby-to-user entries to the top.
  const restaurantsWithDistance = useMemo(() => {
    const source = result?.restaurants ?? [];
    const list = source.map((r) => ({
      ...r,
      distanceKm: userLocation
        ? distanceKm(userLocation, {
            lat: r.coordinates.latitude,
            lng: r.coordinates.longitude,
          })
        : null,
    }));
    if (userLocation) {
      list.sort((a, b) => {
        const aNear = (a.distanceKm ?? Infinity) <= NEARBY_RADIUS_KM ? 0 : 1;
        const bNear = (b.distanceKm ?? Infinity) <= NEARBY_RADIUS_KM ? 0 : 1;
        if (aNear !== bNear) return aNear - bNear;
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      });
    }
    return list;
  }, [result?.restaurants, userLocation]);

  const nearbyCount = restaurantsWithDistance.filter(
    (r) => r.distanceKm !== null && r.distanceKm <= NEARBY_RADIUS_KM
  ).length;

  // Build the combined marker set for the map: nearby-to-user restaurants
  // (always highlighted) plus any search-result restaurants (highlighted only
  // if they fall within the user's NEARBY_RADIUS_KM radius). Deduped by id.
  const mapRestaurants = useMemo<MapRestaurant[]>(() => {
    const nearbyIds = new Set(nearbyRestaurants.map((r) => r.id));
    const byId = new Map<string, MapRestaurant>();
    const add = (r: ApiResponse["restaurants"][number], forceNearby: boolean) => {
      const isNearby =
        forceNearby ||
        nearbyIds.has(r.id) ||
        (userLocation !== null &&
          distanceKm(userLocation, {
            lat: r.coordinates.latitude,
            lng: r.coordinates.longitude,
          }) <= NEARBY_RADIUS_KM);
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        lat: r.coordinates.latitude,
        lng: r.coordinates.longitude,
        isNearby,
      });
    };
    for (const r of nearbyRestaurants) add(r, true);
    for (const r of restaurantsWithDistance) add(r, false);
    return Array.from(byId.values());
  }, [nearbyRestaurants, restaurantsWithDistance, userLocation]);

  // When a selection is active, the map pans to that one point. When a
  // search is active (no selection), the map fits all result pins at once.
  // Otherwise it falls back to the user's geolocation or a world view.
  const resultPoints = useMemo(() => {
    if (selected || !result?.restaurants) return [];
    return result.restaurants.map((r) => ({
      lat: r.coordinates.latitude,
      lng: r.coordinates.longitude,
    }));
  }, [selected, result]);

  // Callback for clickable map markers — looks up the full Restaurant in
  // either the search results or the nearby-pin list and selects it.
  function selectRestaurantById(id: string) {
    const target =
      result?.restaurants.find((r) => r.id === id) ??
      nearbyRestaurants.find((r) => r.id === id);
    if (target) setSelected(target);
  }

  // Location passed to the map for a distinct "selected" pin.
  const selectedMapPoint = useMemo(() => {
    if (!selected) return null;
    return {
      id: selected.id,
      name: selected.name,
      lat: selected.coordinates.latitude,
      lng: selected.coordinates.longitude,
    };
  }, [selected]);

  return (
    <div className="relative min-h-screen bg-stone-950">
      {/* Full-viewport map background. `next/dynamic({ ssr: false, loading })`
          renders the loading element on the server and during the client-side
          chunk load, so no extra mount gate is needed. */}
      <div className="fixed inset-0 z-0">
        <MapBackground
          userLocation={userLocation}
          restaurants={mapRestaurants}
          resultPoints={resultPoints}
          selectedPoint={selectedMapPoint}
          onSelectById={selectRestaurantById}
        />
        {/* Gradient overlay so the overlay content stays legible over tiles */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-stone-950/70 via-stone-950/30 to-stone-950/80"
        />
      </div>

      {selected && (
        <aside className="fixed right-4 top-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-stone-950/85 p-5 shadow-2xl shadow-black/50 ring-1 ring-amber-400/40 backdrop-blur-lg sm:right-6 sm:top-6">
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Close detail"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            Selected
          </p>
          <h3 className="mt-1 pr-6 text-lg font-semibold leading-tight text-white">
            {selected.name}
          </h3>
          {selected.rating !== null && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-3.5 w-3.5 text-amber-400"
              >
                <path d="M12 17.3 5.8 21l1.7-7.1L2 9.2l7.2-.6L12 2l2.8 6.6 7.2.6-5.5 4.7 1.7 7.1z" />
              </svg>
              <span className="text-xs font-semibold tabular-nums text-amber-300">
                {selected.rating.toFixed(1)}
              </span>
            </div>
          )}
          {selected.address && (
            <p className="mt-3 text-sm leading-relaxed text-stone-300">
              {selected.address}
            </p>
          )}
          <p className="mt-2 font-mono text-[11px] text-stone-400">
            {selected.coordinates.latitude.toFixed(4)},{" "}
            {selected.coordinates.longitude.toFixed(4)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
            {selected.phone && (
              <a
                href={`tel:${selected.phone}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-stone-200 transition-colors hover:bg-white/15"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {selected.phone}
              </a>
            )}
            {(() => {
              const lat = selected.coordinates.latitude;
              const lng = selected.coordinates.longitude;
              // Directions URL: Google Maps picks the user's current location
              // as the origin by default. Appending `destination_place_id`
              // makes Maps land on the canonical listing, not just the coord.
              const directionsUrl = selected.placeId
                ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${selected.placeId}`
                : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination=${encodeURIComponent(selected.name)}`;
              return (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-stone-950 transition-colors hover:bg-amber-400"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M3 11 22 2l-9 19-2-8-8-2z" />
                  </svg>
                  Directions
                </a>
              );
            })()}
          </div>
        </aside>
      )}

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 lg:px-8 lg:pt-28">
        {/* When a card is selected, hide the hero, search bar, and grid —
            the map + detail panel become the whole view. */}
        {!selected && (
          <>
        {/* Hero */}
        <header className="mx-auto max-w-2xl">
          <div className="rounded-3xl bg-stone-950/35 px-8 py-10 text-center ring-1 ring-white/10 backdrop-blur-md">
            <h1 className="text-balance text-5xl font-semibold tracking-tight text-white sm:text-6xl">
              Find great restaurants,{" "}
              <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">
                anywhere
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-pretty text-base leading-relaxed text-stone-300">
              Search any city to discover top-rated spots, ratings, and contact details in seconds.
            </p>
          </div>
        </header>

        {/* Search */}
        <form onSubmit={handleSubmit} className="mx-auto mt-10 max-w-xl">
          <div className="group relative rounded-2xl bg-white/95 shadow-2xl shadow-black/30 ring-1 ring-white/20 backdrop-blur-md transition-all focus-within:shadow-2xl focus-within:shadow-amber-500/20 focus-within:ring-2 focus-within:ring-amber-400/60">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                suppressedInputRef.current = null;
                setShowSuggestions(true);
              }}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              onBlur={() => {
                // Delay close so clicks on suggestion items register first
                setTimeout(() => setShowSuggestions(false), 150);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Try San Francisco, Tokyo, Barcelona…"
              required
              autoComplete="off"
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="city-suggestions"
              aria-activedescendant={activeIndex >= 0 ? `city-suggestion-${activeIndex}` : undefined}
              className="h-16 w-full rounded-2xl bg-transparent pl-14 pr-36 text-base text-stone-900 placeholder:text-stone-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-2 top-1/2 inline-flex h-12 -translate-y-1/2 items-center gap-2 rounded-xl bg-stone-900 px-5 text-sm font-semibold text-white shadow-lg shadow-stone-900/20 transition-all hover:bg-stone-800 hover:shadow-xl hover:shadow-stone-900/30 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <svg
                    aria-hidden
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      opacity="0.25"
                    />
                    <path
                      d="M12 2a10 10 0 0 1 10 10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  Searching
                </>
              ) : (
                "Search"
              )}
            </button>

            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="city-suggestions"
                role="listbox"
                className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl bg-white/95 py-2 shadow-2xl shadow-black/30 ring-1 ring-white/20 backdrop-blur-md"
              >
                {suggestions.map((s, i) => (
                  <li
                    key={s.placeId}
                    id={`city-suggestion-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(e) => {
                      // Prevent input blur before click registers
                      e.preventDefault();
                      pickSuggestion(s);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex cursor-pointer items-center gap-3 px-5 py-3 text-left transition-colors ${
                      i === activeIndex
                        ? "bg-stone-200/80"
                        : "hover:bg-stone-100/80"
                    }`}
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 shrink-0 text-stone-400"
                    >
                      <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-stone-900">
                        {s.main}
                      </div>
                      {s.secondary && (
                        <div className="truncate text-xs text-stone-500">
                          {s.secondary}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>

        {/* Results area */}
        <div className="mt-16">
          {error && (
            <div className="mx-auto max-w-xl rounded-2xl bg-red-950/60 p-5 ring-1 ring-red-400/30 backdrop-blur-md">
              <div className="flex items-start gap-3">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-5 w-5 shrink-0 text-red-300"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <p className="text-sm leading-relaxed text-red-200">
                  {error}
                </p>
              </div>
            </div>
          )}

          {loading && <SkeletonGrid />}

          {!loading && !error && restaurantsWithDistance.length > 0 && (
            <section>
              <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0 rounded-2xl bg-stone-950/60 px-5 py-3 ring-1 ring-white/10 backdrop-blur-md">
                  <p className="text-xs font-medium uppercase tracking-wider text-stone-300">
                    Results
                  </p>
                  <h2 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-white">
                    {searchedCity}
                  </h2>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {geoStatus === "granted" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-950/70 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-white/10 backdrop-blur-md">
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      {nearbyCount > 0
                        ? `${nearbyCount} within ${NEARBY_RADIUS_KM} km of you`
                        : `None within ${NEARBY_RADIUS_KM} km of you`}
                    </span>
                  )}
                  <span className="rounded-full bg-stone-950/70 px-3 py-1 text-xs font-medium text-stone-200 ring-1 ring-white/10 backdrop-blur-md">
                    {total > restaurantsWithDistance.length
                      ? `${restaurantsWithDistance.length} of ${total}`
                      : `${restaurantsWithDistance.length} ${restaurantsWithDistance.length === 1 ? "result" : "results"}`}
                  </span>
                </div>
              </header>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {restaurantsWithDistance.map((r) => {
                  const isNearUser =
                    r.distanceKm !== null &&
                    r.distanceKm <= NEARBY_RADIUS_KM;
                  const ringClasses = isNearUser
                    ? "ring-2 ring-emerald-400/70 hover:ring-emerald-400/90"
                    : "ring-1 ring-white/15 hover:ring-white/30";
                  // IDs for aria-describedby so the stretched selection button
                  // exposes the card's description to screen readers. Only
                  // reference IDs that will actually render — many Overpass
                  // results lack a rating and some lack an address.
                  const addressId = `card-${r.id}-addr`;
                  const ratingId = `card-${r.id}-rating`;
                  const describedBy =
                    [r.address ? addressId : null, r.rating !== null ? ratingId : null]
                      .filter(Boolean)
                      .join(" ") || undefined;
                  return (
                  <li key={r.id}>
                    <article
                      className={`group relative h-full rounded-2xl bg-stone-900/70 p-6 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-stone-900/80 hover:shadow-xl hover:shadow-black/40 ${ringClasses}`}
                    >
                      {/* Stretched button covers the whole card. Interactive
                          children below (phone link) sit above it with a
                          higher z-index so they stay individually clickable.
                          aria-describedby pulls in the card text for SR users. */}
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        aria-label={`View ${r.name}`}
                        aria-describedby={describedBy}
                        className="absolute inset-0 z-10 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      />
                      {isNearUser && r.distanceKm !== null && (
                        <span className="absolute -top-2 left-4 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm">
                          <svg
                            aria-hidden
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3 w-3"
                          >
                            <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          {r.distanceKm < 1
                            ? `${Math.round(r.distanceKm * 1000)} m`
                            : `${r.distanceKm.toFixed(1)} km`}
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 text-base font-semibold leading-snug text-white">
                          {r.name}
                        </h3>
                        {r.rating !== null && (
                          <div
                            id={ratingId}
                            className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1"
                            aria-label={`Rated ${r.rating.toFixed(1)} out of 5`}
                          >
                            <svg
                              aria-hidden
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-3.5 w-3.5 text-amber-400"
                            >
                              <path d="M12 17.3 5.8 21l1.7-7.1L2 9.2l7.2-.6L12 2l2.8 6.6 7.2.6-5.5 4.7 1.7 7.1z" />
                            </svg>
                            <span className="text-xs font-semibold tabular-nums text-amber-300">
                              {r.rating.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </div>

                      {r.address && (
                        <p
                          id={addressId}
                          className="mt-3 line-clamp-2 text-sm leading-relaxed text-stone-300"
                        >
                          {r.address}
                        </p>
                      )}

                      {r.cuisine && (
                        <span className="mt-3 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-stone-200">
                          {r.cuisine}
                        </span>
                      )}

                      <div className="relative z-20 mt-4 space-y-2 border-t border-white/10 pt-4">
                        {r.phone && (
                          <a
                            href={`tel:${r.phone}`}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-300 transition-colors hover:text-amber-400"
                          >
                            <svg
                              aria-hidden
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-3.5 w-3.5"
                            >
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                            {r.phone}
                          </a>
                        )}
                        {/* Coordinates are always displayed per the spec. */}
                        <div className="font-mono text-[11px] text-stone-400">
                          {r.coordinates.latitude.toFixed(4)},{" "}
                          {r.coordinates.longitude.toFixed(4)}
                        </div>
                      </div>
                    </article>
                  </li>
                  );
                })}
              </ul>
            </section>
          )}

          {hasSearched && !error && restaurantsWithDistance.length === 0 && <EmptyState city={searchedCity} />}
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="h-48 animate-pulse rounded-2xl bg-stone-900/60 ring-1 ring-white/10 backdrop-blur-md"
        >
          <div className="p-6">
            <div className="h-4 w-2/3 rounded bg-white/10" />
            <div className="mt-4 h-3 w-full rounded bg-white/5" />
            <div className="mt-2 h-3 w-4/5 rounded bg-white/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ city }: { city: string }) {
  return (
    <div className="mx-auto mt-8 max-w-md rounded-2xl bg-stone-900/60 p-8 text-center ring-1 ring-white/10 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-stone-300"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <h3 className="mt-4 text-base font-semibold text-white">
        No restaurants found
      </h3>
      <p className="mt-1.5 text-sm text-stone-300">
        We couldn&apos;t find anything matching &ldquo;{city}&rdquo;. Try a different city or check the spelling.
      </p>
    </div>
  );
}
