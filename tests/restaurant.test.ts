import { describe, it, expect } from "vitest";
import {
  SearchInputSchema,
  RestaurantSchema,
  YelpBusinessSchema,
  YelpResponseSchema,
  OverpassElementSchema,
  OverpassResponseSchema,
} from "../src/lib/validations/restaurant";

describe("SearchInputSchema", () => {
  it("accepts city with apiKey", () => {
    const result = SearchInputSchema.safeParse({
      city: "San Francisco",
      apiKey: "abcdefghijklmnopqrstuvwxyz1234",
    });
    expect(result.success).toBe(true);
  });

  it("accepts city without apiKey (defaults to empty string)", () => {
    const result = SearchInputSchema.safeParse({ city: "Portland" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiKey).toBe("");
    }
  });

  it("accepts empty apiKey string", () => {
    const result = SearchInputSchema.safeParse({ city: "Chicago", apiKey: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiKey).toBe("");
    }
  });

  it("rejects empty city", () => {
    const result = SearchInputSchema.safeParse({ city: "", apiKey: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing city", () => {
    const result = SearchInputSchema.safeParse({ apiKey: "key" });
    expect(result.success).toBe(false);
  });

  it("rejects city over 100 characters", () => {
    const result = SearchInputSchema.safeParse({ city: "A".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from city", () => {
    const result = SearchInputSchema.safeParse({ city: "  Seattle  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.city).toBe("Seattle");
    }
  });
});

describe("RestaurantSchema (unified)", () => {
  const validRestaurant = {
    id: "abc-123",
    name: "Test Restaurant",
    rating: 4.5,
    coordinates: { latitude: 37.7749, longitude: -122.4194 },
    address: "123 Main St, San Francisco, CA",
    source: "yelp" as const,
    cuisine: null,
    phone: null,
  };

  it("accepts valid yelp restaurant", () => {
    expect(RestaurantSchema.safeParse(validRestaurant).success).toBe(true);
  });

  it("accepts valid openstreetmap restaurant", () => {
    const osm = {
      ...validRestaurant,
      id: "osm-node-123",
      source: "openstreetmap" as const,
      rating: null,
      cuisine: "italian",
    };
    expect(RestaurantSchema.safeParse(osm).success).toBe(true);
  });

  it("accepts null rating (OSM has no ratings)", () => {
    expect(
      RestaurantSchema.safeParse({ ...validRestaurant, rating: null }).success
    ).toBe(true);
  });

  it("rejects invalid source", () => {
    expect(
      RestaurantSchema.safeParse({ ...validRestaurant, source: "google" }).success
    ).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validRestaurant;
    expect(RestaurantSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects string coordinates", () => {
    expect(
      RestaurantSchema.safeParse({
        ...validRestaurant,
        coordinates: { latitude: "37.77", longitude: "-122.41" },
      }).success
    ).toBe(false);
  });

  it("rejects missing coordinates", () => {
    const { coordinates: _, ...noCoords } = validRestaurant;
    expect(RestaurantSchema.safeParse(noCoords).success).toBe(false);
  });
});

describe("YelpBusinessSchema", () => {
  const validBusiness = {
    id: "yelp-abc",
    name: "Yelp Place",
    rating: 4.0,
    coordinates: { latitude: 37.77, longitude: -122.41 },
    location: { display_address: ["123 Main St", "SF, CA"] },
  };

  it("accepts valid business", () => {
    expect(YelpBusinessSchema.safeParse(validBusiness).success).toBe(true);
  });

  it("rejects rating above 5", () => {
    expect(
      YelpBusinessSchema.safeParse({ ...validBusiness, rating: 5.5 }).success
    ).toBe(false);
  });

  it("rejects rating below 0", () => {
    expect(
      YelpBusinessSchema.safeParse({ ...validBusiness, rating: -1 }).success
    ).toBe(false);
  });

  it("rejects non-array display_address", () => {
    expect(
      YelpBusinessSchema.safeParse({
        ...validBusiness,
        location: { display_address: "123 Main St" },
      }).success
    ).toBe(false);
  });
});

describe("YelpResponseSchema", () => {
  it("accepts valid response", () => {
    const result = YelpResponseSchema.safeParse({
      businesses: [
        {
          id: "abc",
          name: "Place",
          rating: 4,
          coordinates: { latitude: 37.77, longitude: -122.41 },
          location: { display_address: ["1 St", "SF, CA"] },
        },
      ],
      total: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty businesses array", () => {
    expect(
      YelpResponseSchema.safeParse({ businesses: [], total: 0 }).success
    ).toBe(true);
  });

  it("rejects missing total", () => {
    expect(YelpResponseSchema.safeParse({ businesses: [] }).success).toBe(false);
  });
});

describe("OverpassElementSchema", () => {
  it("accepts node with lat/lon", () => {
    const result = OverpassElementSchema.safeParse({
      type: "node",
      id: 12345,
      lat: 41.89,
      lon: -87.6,
      tags: { name: "Lou Malnati's", amenity: "restaurant", cuisine: "pizza" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts way with center", () => {
    const result = OverpassElementSchema.safeParse({
      type: "way",
      id: 67890,
      center: { lat: 43.65, lon: -70.25 },
      nodes: [1, 2, 3],
      tags: { name: "Some Restaurant", amenity: "restaurant" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts element without tags", () => {
    const result = OverpassElementSchema.safeParse({
      type: "node",
      id: 111,
      lat: 40.0,
      lon: -74.0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts element with extra tags (passthrough)", () => {
    const result = OverpassElementSchema.safeParse({
      type: "node",
      id: 222,
      lat: 40.0,
      lon: -74.0,
      tags: {
        name: "Test",
        amenity: "restaurant",
        wheelchair: "yes",
        opening_hours: "Mo-Fr 9-5",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid type", () => {
    expect(
      OverpassElementSchema.safeParse({ type: "point", id: 1, lat: 0, lon: 0 })
        .success
    ).toBe(false);
  });

  it("rejects non-numeric id", () => {
    expect(
      OverpassElementSchema.safeParse({ type: "node", id: "abc", lat: 0, lon: 0 })
        .success
    ).toBe(false);
  });

  it("rejects string coordinates", () => {
    expect(
      OverpassElementSchema.safeParse({
        type: "node",
        id: 1,
        lat: "41.89",
        lon: "-87.60",
      }).success
    ).toBe(false);
  });
});

describe("OverpassResponseSchema", () => {
  it("accepts valid response with elements", () => {
    const result = OverpassResponseSchema.safeParse({
      elements: [
        { type: "node", id: 1, lat: 41.89, lon: -87.6, tags: { name: "Test" } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty elements array", () => {
    expect(
      OverpassResponseSchema.safeParse({ elements: [] }).success
    ).toBe(true);
  });

  it("rejects missing elements", () => {
    expect(OverpassResponseSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-array elements", () => {
    expect(
      OverpassResponseSchema.safeParse({ elements: "not array" }).success
    ).toBe(false);
  });
});
