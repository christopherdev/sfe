import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRateLimited } from "@/lib/rate-limit";

const GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

const AutocompleteInputSchema = z.object({
  input: z.string().trim().min(1).max(100),
});

const GoogleAutocompleteResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z.object({
          placeId: z.string(),
          text: z.object({ text: z.string() }),
          structuredFormat: z
            .object({
              mainText: z.object({ text: z.string() }).optional(),
              secondaryText: z.object({ text: z.string() }).optional(),
            })
            .optional(),
        }),
      })
    )
    .optional()
    .default([]),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip, { bucket: "autocomplete", maxRequests: 60 })) {
    return NextResponse.json({ suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GOOGLE_PLACES_API_KEY." },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ suggestions: [] });
  }

  const parsed = AutocompleteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ suggestions: [] });
  }

  const response = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify({
      input: parsed.data.input,
      includedPrimaryTypes: ["locality", "administrative_area_level_3"],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ suggestions: [] });
  }

  const data = await response.json();
  const validated = GoogleAutocompleteResponseSchema.safeParse(data);
  if (!validated.success) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions = validated.data.suggestions.map((s) => ({
    placeId: s.placePrediction.placeId,
    text: s.placePrediction.text.text,
    main: s.placePrediction.structuredFormat?.mainText?.text ?? s.placePrediction.text.text,
    secondary: s.placePrediction.structuredFormat?.secondaryText?.text ?? "",
  }));

  return NextResponse.json({ suggestions });
}
