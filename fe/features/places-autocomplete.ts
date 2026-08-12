export interface PlaceSuggestion {
  id: string;
  label: string;
  // Present only for providers (Geoapify) whose autocomplete response
  // already carries full place details — resolvePlace() skips a second
  // network round-trip when this is set.
  resolved?: ResolvedPlace;
}

export interface ResolvedPlace {
  name: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
}

const EARTH_RADIUS_METERS = 6371000;
const MIN_RADIUS_METERS = 500;
const MAX_RADIUS_METERS = 25000;

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A place's bounding box is sized to fit the place itself (a neighborhood
// gets a tight box, a city a wide one). Deriving the search radius from it —
// half the box's diagonal — keeps "search near X" proportional to how big X
// actually is, instead of one fixed radius for both a neighborhood and an
// entire city.
function radiusFromCorners(
  low: { lat: number; lng: number },
  high: { lat: number; lng: number }
): number {
  const center = { lat: (low.lat + high.lat) / 2, lng: (low.lng + high.lng) / 2 };
  const radius = haversineMeters(center, high);
  return Math.min(Math.max(radius, MIN_RADIUS_METERS), MAX_RADIUS_METERS);
}

const PROVIDER: 'google' | 'geoapify' =
  process.env.EXPO_PUBLIC_PLACES_PROVIDER === 'geoapify' ? 'geoapify' : 'google';

// ---- Google Places API (New), proxied — the API doesn't send permissive
// CORS headers for direct browser calls, unlike Geoapify below. ----

async function searchPlacesGoogle(input: string): Promise<PlaceSuggestion[]> {
  const resp = await fetch(
    `${process.env.EXPO_PUBLIC_CORS_PROXY_URL || 'http://localhost:8080'}/gplaces/v1/places:autocomplete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY!,
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
      body: JSON.stringify({ input }),
    }
  );
  if (!resp.ok) throw new Error(`Autocomplete failed: ${resp.status}`);
  const data = await resp.json();

  return (data.suggestions || [])
    .map((s: any) => s.placePrediction)
    .filter(Boolean)
    .map((p: any) => ({ id: p.placeId, label: p.text?.text || '' }));
}

async function resolvePlaceGoogle(placeId: string): Promise<ResolvedPlace | null> {
  const resp = await fetch(
    `${process.env.EXPO_PUBLIC_CORS_PROXY_URL || 'http://localhost:8080'}/gplaces/v1/places/${placeId}?fields=id,displayName,formattedAddress,location,viewport`,
    { headers: { 'X-Goog-Api-Key': process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY! } }
  );
  if (!resp.ok) throw new Error(`Place details failed: ${resp.status}`);
  const details = await resp.json();
  if (!details.location) return null;

  return {
    name: details.formattedAddress || details.displayName?.text || '',
    lat: details.location.latitude,
    lng: details.location.longitude,
    radiusMeters: details.viewport
      ? radiusFromCorners(
          { lat: details.viewport.low.latitude, lng: details.viewport.low.longitude },
          { lat: details.viewport.high.latitude, lng: details.viewport.high.longitude }
        )
      : undefined,
  };
}

// ---- Geoapify Geocoding Autocomplete — sends permissive CORS headers, so
// this can be called straight from the browser, and the autocomplete
// response already carries coordinates + a bounding box per suggestion, so
// there's no separate "place details" round-trip like Google's. ----

async function searchPlacesGeoapify(input: string): Promise<PlaceSuggestion[]> {
  const apiKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY || '';
  const params = new URLSearchParams({ text: input, apiKey });

  const resp = await fetch(
    `https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`
  );
  if (!resp.ok) throw new Error(`Geoapify autocomplete failed: ${resp.status}`);
  const data = await resp.json();

  return (data.features || []).map((f: any) => {
    const p = f.properties || {};
    const name = p.formatted || p.name || '';
    const [minLon, minLat, maxLon, maxLat] = f.bbox || [];

    const resolved: ResolvedPlace = {
      name,
      lat: p.lat,
      lng: p.lon,
      radiusMeters: f.bbox
        ? radiusFromCorners({ lat: minLat, lng: minLon }, { lat: maxLat, lng: maxLon })
        : undefined,
    };

    return { id: p.place_id, label: name, resolved };
  });
}

// ---- Provider-agnostic surface used by the UI components ----

export async function searchPlaces(input: string): Promise<PlaceSuggestion[]> {
  return PROVIDER === 'geoapify' ? searchPlacesGeoapify(input) : searchPlacesGoogle(input);
}

export async function resolvePlace(
  suggestion: PlaceSuggestion
): Promise<ResolvedPlace | null> {
  if (suggestion.resolved) return suggestion.resolved;
  return resolvePlaceGoogle(suggestion.id);
}
