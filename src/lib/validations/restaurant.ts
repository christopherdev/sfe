import { z } from "zod";

// The server uses its own Google Places API key from the environment, so
// the client only needs to send the city name.
export const SearchInputSchema = z.object({
  // Expected to be a city name. Free-text like "best pizza" will be accepted
  // by the HTTP layer but produces unpredictable geocoding results.
  city: z
    .string()
    .min(1, "City is required")
    .max(100, "City name too long")
    .trim(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

// Unified restaurant shape. No `source` field — there's only one data source
// and the envelope covers it.
export const RestaurantSchema = z.object({
  id: z.string(),
  name: z.string(),
  rating: z.number().nullable(),
  coordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  address: z.string(),
  cuisine: z.string().nullable(),
  phone: z.string().nullable(),
});

export type Restaurant = z.infer<typeof RestaurantSchema>;

// Google Places (New) response shape for the searchNearby body we receive.
export const GooglePlaceSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }),
  rating: z.number().min(0).max(5).optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  formattedAddress: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
});

export const GooglePlacesResponseSchema = z.object({
  places: z.array(GooglePlaceSchema).optional().default([]),
});

// API response envelope the client consumes.
export const ApiResponseSchema = z.object({
  restaurants: z.array(RestaurantSchema),
  total: z.number(),
  source: z.literal("google"),
  // Canonical city name returned by Google Geocoding (e.g., "San Francisco,
  // CA, USA" when the user typed "sf"). Displayed in the results header.
  resolvedLocation: z.string().optional(),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;
