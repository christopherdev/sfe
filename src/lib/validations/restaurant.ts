import { z } from "zod";

export const SearchInputSchema = z.object({
  city: z
    .string()
    .min(1, "City is required")
    .max(100, "City name too long")
    .trim(),
  apiKey: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine(
      (val) => val === "" || /^[a-zA-Z0-9_-]{20,128}$/.test(val),
      "API key format is invalid"
    ),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

// Unified restaurant shape both APIs normalize into
export const RestaurantSchema = z.object({
  id: z.string(),
  name: z.string(),
  rating: z.number().nullable(),
  coordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  address: z.string(),
  source: z.enum(["yelp", "openstreetmap"]),
  cuisine: z.string().nullable(),
  phone: z.string().nullable(),
});

export type Restaurant = z.infer<typeof RestaurantSchema>;

// Yelp-specific schemas for response validation
export const YelpBusinessSchema = z.object({
  id: z.string(),
  name: z.string(),
  rating: z.number().min(0).max(5),
  coordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  location: z.object({
    display_address: z.array(z.string()),
  }),
  phone: z.string().optional(),
});

export const YelpResponseSchema = z.object({
  businesses: z.array(YelpBusinessSchema),
  total: z.number(),
});

// Overpass-specific schemas
export const OverpassElementSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z
    .object({
      lat: z.number(),
      lon: z.number(),
    })
    .optional(),
  tags: z
    .object({
      name: z.string().optional(),
      amenity: z.string().optional(),
      cuisine: z.string().optional(),
      phone: z.string().optional(),
      "addr:housenumber": z.string().optional(),
      "addr:street": z.string().optional(),
      "addr:city": z.string().optional(),
      "addr:state": z.string().optional(),
      "addr:postcode": z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export const OverpassResponseSchema = z.object({
  elements: z.array(OverpassElementSchema),
});

// Nominatim geocoding response
const BboxTupleSchema = z.tuple([
  z.string().regex(/^-?\d+(\.\d+)?$/),
  z.string().regex(/^-?\d+(\.\d+)?$/),
  z.string().regex(/^-?\d+(\.\d+)?$/),
  z.string().regex(/^-?\d+(\.\d+)?$/),
]);

export const NominatimResultSchema = z.object({
  boundingbox: BboxTupleSchema,
  display_name: z.string(),
  place_rank: z.number(),
});

export const NominatimResponseSchema = z.array(NominatimResultSchema).min(1);

// API response schema for client-side validation
export const ApiResponseSchema = z.object({
  restaurants: z.array(RestaurantSchema),
  total: z.number(),
  source: z.enum(["yelp", "openstreetmap"]),
  resolvedLocation: z.string().optional(),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;
