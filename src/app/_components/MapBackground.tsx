"use client";

import { useEffect, useMemo } from "react";
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";

export interface MapRestaurant {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isNearby: boolean;
}

export interface SelectedPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface LatLng {
  lat: number;
  lng: number;
}

interface MapBackgroundProps {
  userLocation: LatLng | null;
  restaurants: MapRestaurant[];
  // When set, the map fits bounds over all result points (new search).
  // Empty array means "no active search or a selection is active".
  resultPoints: LatLng[];
  // When set, the map pans to this single point (focus/detail mode).
  selectedPoint: SelectedPoint | null;
  // Called when a restaurant marker is clicked on the map. Page-level code
  // resolves the id back to a full Restaurant and selects it.
  onSelectById: (id: string) => void;
}

// `NEXT_PUBLIC_` means this key is bundled into the client JS — which is how
// Google Maps JS API keys are *supposed* to be used. This must be a SEPARATE
// key from GOOGLE_PLACES_API_KEY, restricted in GCP Console to:
//   1. HTTP referrer: your prod + dev hostnames only
//   2. APIs: Maps JavaScript API only (NOT Places — that stays server-side)
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Custom Map Id from GCP Console → Map Styles. When set, the map uses your
// cloud-styled theme (e.g. a dark theme that matches the rest of the UI).
// Falls back to Google's public DEMO_MAP_ID, which is required for
// AdvancedMarker to render but uses the default light theme.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

// Positioning strategy — one effect, one decision. Priority:
//   1. selectedPoint → panTo + setZoom(15)  (focus mode)
//   2. resultPoints  → fitBounds            (new search)
//   3. userLocation  → panTo + setZoom(14)  (just the user)
function MapPositioning({
  selectedPoint,
  resultPoints,
  userLocation,
}: {
  selectedPoint: SelectedPoint | null;
  resultPoints: LatLng[];
  userLocation: LatLng | null;
}) {
  const map = useMap();
  // `LatLngBounds` lives in the `core` library, not `maps`.
  const coreLib = useMapsLibrary("core");

  // Stable key so the effect only re-runs when the positioning intent
  // actually changes — not on every parent re-render with equivalent data.
  const intentKey = useMemo(() => {
    if (selectedPoint) {
      return `sel:${selectedPoint.lat.toFixed(5)},${selectedPoint.lng.toFixed(5)}`;
    }
    if (resultPoints.length > 0) {
      const first = resultPoints[0];
      return `res:${resultPoints.length}:${first.lat.toFixed(5)},${first.lng.toFixed(5)}`;
    }
    if (userLocation) {
      return `user:${userLocation.lat.toFixed(5)},${userLocation.lng.toFixed(5)}`;
    }
    return "none";
  }, [selectedPoint, resultPoints, userLocation]);

  useEffect(() => {
    if (!map || !coreLib) return;
    if (selectedPoint) {
      map.panTo({ lat: selectedPoint.lat, lng: selectedPoint.lng });
      map.setZoom(15);
      return;
    }
    if (resultPoints.length > 0) {
      const bounds = new coreLib.LatLngBounds();
      for (const p of resultPoints) bounds.extend(p);
      // Leave breathing room for the top-right detail panel and the search
      // bar / hero area above the map.
      map.fitBounds(bounds, { top: 140, right: 360, bottom: 80, left: 80 });
      return;
    }
    if (userLocation) {
      map.panTo(userLocation);
      map.setZoom(14);
    }
    // We intentionally depend on intentKey (not the raw props) so the effect
    // re-runs only when the positioning intent actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, coreLib, intentKey]);

  return null;
}

export default function MapBackground({
  userLocation,
  restaurants,
  resultPoints,
  selectedPoint,
  onSelectById,
}: MapBackgroundProps) {
  // No key → render a plain dark surface. Avoids Google's "for development
  // purposes only" watermark and makes the missing-config case obvious.
  if (!MAPS_API_KEY) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-stone-950 text-xs text-stone-500">
        Map disabled — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local
      </div>
    );
  }

  const initialCenter = selectedPoint
    ? { lat: selectedPoint.lat, lng: selectedPoint.lng }
    : userLocation ?? { lat: 20, lng: 0 };
  const initialZoom = selectedPoint || userLocation ? 14 : 2;

  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      <Map
        defaultCenter={initialCenter}
        defaultZoom={initialZoom}
        gestureHandling="greedy"
        disableDefaultUI={false}
        zoomControl
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        // mapId is required for AdvancedMarker. Set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
        // to your own cloud-styled Map Id to theme the map (e.g. dark mode);
        // falls back to Google's public DEMO_MAP_ID.
        mapId={MAP_ID}
        className="h-full w-full"
        style={{ background: "#0c0a09" }}
      >
        <MapPositioning
          selectedPoint={selectedPoint}
          resultPoints={resultPoints}
          userLocation={userLocation}
        />

        {userLocation && (
          <AdvancedMarker
            position={{ lat: userLocation.lat, lng: userLocation.lng }}
            title="You are here"
          >
            <Pin
              background="#3b82f6"
              borderColor="#1d4ed8"
              glyphColor="#eff6ff"
              scale={0.9}
            />
          </AdvancedMarker>
        )}

        {restaurants.map((r) => (
          <AdvancedMarker
            key={r.id}
            position={{ lat: r.lat, lng: r.lng }}
            title={r.name}
            onClick={() => onSelectById(r.id)}
          >
            <Pin
              background={r.isNearby ? "#10b981" : "#a8a29e"}
              borderColor={r.isNearby ? "#047857" : "#57534e"}
              glyphColor={r.isNearby ? "#064e3b" : "#44403c"}
              scale={r.isNearby ? 1.0 : 0.7}
            />
          </AdvancedMarker>
        ))}

        {/* Selected pin stacks above everything else via zIndex */}
        {selectedPoint && (
          <>
            <AdvancedMarker
              position={{ lat: selectedPoint.lat, lng: selectedPoint.lng }}
              title={selectedPoint.name}
              zIndex={1000}
              onClick={() => onSelectById(selectedPoint.id)}
            >
              <Pin
                background="#fbbf24"
                borderColor="#b45309"
                glyphColor="#78350f"
                scale={1.3}
              />
            </AdvancedMarker>
            <InfoWindow
              position={{ lat: selectedPoint.lat, lng: selectedPoint.lng }}
              pixelOffset={[0, -36]}
              headerDisabled
              disableAutoPan
            >
              <div className="px-1 text-xs font-medium text-stone-900">
                {selectedPoint.name}
              </div>
            </InfoWindow>
          </>
        )}
      </Map>
    </APIProvider>
  );
}
