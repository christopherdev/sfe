import { describe, it, expect } from "vitest";
import {
  SearchInputSchema,
  RestaurantSchema,
  GooglePlaceSchema,
  GooglePlacesResponseSchema,
} from "../src/lib/validations/restaurant";

describe("SearchInputSchema", () => {
  it("accepts a valid city", () => {
    const result = SearchInputSchema.safeParse({ city: "San Francisco" });
    expect(result.success).toBe(true);
  });

  it("rejects empty city", () => {
    const result = SearchInputSchema.safeParse({ city: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing city", () => {
    const result = SearchInputSchema.safeParse({});
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

describe("RestaurantSchema", () => {
  const validRestaurant = {
    id: "ChIJabc",
    name: "Test Restaurant",
    rating: 4.5,
    coordinates: { latitude: 37.7749, longitude: -122.4194 },
    address: "123 Main St, San Francisco, CA",
    cuisine: null,
    phone: null,
  };

  it("accepts a valid restaurant", () => {
    expect(RestaurantSchema.safeParse(validRestaurant).success).toBe(true);
  });

  it("accepts null rating", () => {
    expect(
      RestaurantSchema.safeParse({ ...validRestaurant, rating: null }).success
    ).toBe(true);
  });

  it("accepts optional cuisine and phone", () => {
    expect(
      RestaurantSchema.safeParse({
        ...validRestaurant,
        cuisine: "italian",
        phone: "+1 415 555 0100",
      }).success
    ).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _name, ...noName } = validRestaurant;
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
    const { coordinates: _coords, ...noCoords } = validRestaurant;
    expect(RestaurantSchema.safeParse(noCoords).success).toBe(false);
  });
});

describe("GooglePlaceSchema", () => {
  const validPlace = {
    id: "ChIJsomething",
    displayName: { text: "Test Place" },
    rating: 4.3,
    location: { latitude: 37.77, longitude: -122.41 },
    formattedAddress: "123 Main St, San Francisco, CA",
  };

  it("accepts a valid place", () => {
    expect(GooglePlaceSchema.safeParse(validPlace).success).toBe(true);
  });

  it("accepts a place without optional fields", () => {
    expect(
      GooglePlaceSchema.safeParse({
        id: "abc",
        displayName: { text: "Place" },
        location: { latitude: 37.77, longitude: -122.41 },
      }).success
    ).toBe(true);
  });

  it("accepts a place with a phone", () => {
    expect(
      GooglePlaceSchema.safeParse({
        ...validPlace,
        nationalPhoneNumber: "(415) 555-0100",
      }).success
    ).toBe(true);
  });

  it("rejects rating above 5", () => {
    expect(
      GooglePlaceSchema.safeParse({ ...validPlace, rating: 5.5 }).success
    ).toBe(false);
  });

  it("rejects rating below 0", () => {
    expect(
      GooglePlaceSchema.safeParse({ ...validPlace, rating: -1 }).success
    ).toBe(false);
  });

  it("rejects missing displayName", () => {
    const { displayName: _n, ...noName } = validPlace;
    expect(GooglePlaceSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing location", () => {
    const { location: _l, ...noLoc } = validPlace;
    expect(GooglePlaceSchema.safeParse(noLoc).success).toBe(false);
  });
});

describe("GooglePlacesResponseSchema", () => {
  it("accepts a response with places", () => {
    const result = GooglePlacesResponseSchema.safeParse({
      places: [
        {
          id: "abc",
          displayName: { text: "Place" },
          location: { latitude: 37.77, longitude: -122.41 },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty places array", () => {
    expect(
      GooglePlacesResponseSchema.safeParse({ places: [] }).success
    ).toBe(true);
  });

  it("accepts a missing places field (defaults to [])", () => {
    const result = GooglePlacesResponseSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.places).toEqual([]);
    }
  });
});
