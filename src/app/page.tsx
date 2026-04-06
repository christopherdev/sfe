"use client";

import { useState } from "react";
import { ApiResponseSchema, type ApiResponse } from "@/lib/validations/restaurant";

export default function Home() {
  const [city, setCity] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchedCity, setSearchedCity] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmedCity = city.trim();
    setError("");
    setResult(null);
    setLoading(true);
    setSearchedCity(trimmedCity);

    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: trimmedCity, apiKey: apiKey.trim() }),
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

  const restaurants = result?.restaurants ?? [];
  const total = result?.total ?? 0;
  const source = result?.source;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[340px_1fr]">
          {/* Left column — search */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <header className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                Restaurant Search
              </h1>
              <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                Discover restaurants in any city
              </p>
            </header>

            <form onSubmit={handleSearch} className="flex flex-col gap-3">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Enter a city (e.g. San Francisco)"
                required
                className="h-12 rounded-xl border border-stone-200 bg-white px-4 text-sm text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-50 dark:focus:border-amber-400 dark:focus:ring-amber-400/20"
              />
              <div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Yelp API key (optional)"
                  className="h-12 w-full rounded-xl border border-stone-200 bg-white px-4 text-sm text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-50 dark:focus:border-amber-400 dark:focus:ring-amber-400/20"
                />
                <p className="mt-1.5 pl-1 text-xs text-stone-400 dark:text-stone-500">
                  Leave blank to use OpenStreetMap data
                </p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="h-12 rounded-xl bg-amber-600 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-400"
              >
                {loading ? "Searching..." : "Search"}
              </button>
            </form>
          </aside>

          {/* Right column — results */}
          <main className="min-w-0">
            {error && (
              <p className="mb-6 rounded-xl bg-red-50 px-5 py-3.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                {error}
              </p>
            )}

            {restaurants.length > 0 && (
              <section>
                <div className="mb-6 flex items-baseline justify-between">
                  <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-50">
                    {total > restaurants.length
                      ? `${restaurants.length} of ${total} restaurants in ${searchedCity}`
                      : `${restaurants.length} restaurants in ${searchedCity}`}
                  </h2>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                    {source === "yelp" ? "Yelp" : "OpenStreetMap"}
                  </span>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2">
                  {restaurants.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800 dark:bg-stone-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-stone-900 dark:text-stone-50">
                            {r.name}
                          </h3>
                          <p className="mt-1.5 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                            {r.address}
                          </p>
                          {r.cuisine && (
                            <span className="mt-2 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                              {r.cuisine}
                            </span>
                          )}
                        </div>
                        {r.rating !== null && (
                          <div className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 dark:bg-amber-950/40">
                            <span className="text-sm text-amber-500">★</span>
                            <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                              {r.rating}
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="mt-3 border-t border-stone-100 pt-3 font-mono text-xs text-stone-400 dark:border-stone-800 dark:text-stone-500">
                        {r.coordinates.latitude.toFixed(4)},{" "}
                        {r.coordinates.longitude.toFixed(4)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {searchedCity && !loading && !error && restaurants.length === 0 && (
              <p className="mt-12 text-center text-sm text-stone-500 dark:text-stone-400">
                No restaurants found for &ldquo;{searchedCity}&rdquo;
              </p>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
