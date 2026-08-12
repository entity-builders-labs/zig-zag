// Decodes Google's encoded polyline format (the standard algorithm — see
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm)
// into a plain list of coordinates. No external dependency needed for this.
export function decodePolyline(
  encoded: string
): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

async function fetchWalkingRouteFromGoogle(
  points: { latitude: number; longitude: number }[]
): Promise<{ latitude: number; longitude: number }[]> {
  const origin = `${points[0].latitude},${points[0].longitude}`;
  const destination = `${points[points.length - 1].latitude},${points[points.length - 1].longitude}`;
  // Directions API allows up to 25 waypoints per request.
  const waypoints = points
    .slice(1, -1)
    .slice(0, 25)
    .map((p) => `${p.latitude},${p.longitude}`)
    .join('|');

  const params = new URLSearchParams({
    origin,
    destination,
    mode: 'walking',
    key: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  });
  if (waypoints) params.set('waypoints', waypoints);

  // Proxied through cors-proxy: the Directions API (unlike the Maps JS SDK)
  // doesn't send permissive CORS headers for direct browser calls.
  const baseUrl =
    process.env.EXPO_PUBLIC_CORS_PROXY_URL || 'http://localhost:8080';

  const resp = await fetch(
    `${baseUrl}/proxy/maps/api/directions/json?${params.toString()}`
  );
  if (!resp.ok) throw new Error(`Directions request failed: ${resp.status}`);
  const data = await resp.json();

  if (data.status !== 'OK' || !data.routes?.[0]?.overview_polyline?.points) {
    throw new Error(`Directions API error: ${data.status}`);
  }

  return decodePolyline(data.routes[0].overview_polyline.points);
}

async function fetchWalkingRouteFromGeoapify(
  points: { latitude: number; longitude: number }[]
): Promise<{ latitude: number; longitude: number }[]> {
  const apiKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY || '';
  const waypoints = points.map((p) => `${p.latitude},${p.longitude}`).join('|');
  const params = new URLSearchParams({
    waypoints,
    mode: 'walk',
    apiKey,
  });

  // Geoapify sends permissive CORS headers, so this can be called straight
  // from the browser — no proxy needed, unlike the Google Directions API.
  const resp = await fetch(
    `https://api.geoapify.com/v1/routing?${params.toString()}`
  );
  if (!resp.ok) throw new Error(`Geoapify routing request failed: ${resp.status}`);
  const data = await resp.json();

  const geometry = data.features?.[0]?.geometry;
  let coordinates: [number, number][] = [];
  if (geometry?.type === 'MultiLineString') {
    // One sub-array of [lon, lat] pairs per leg between waypoints — flatten
    // one level to get a single continuous list.
    coordinates = geometry.coordinates.flat(1);
  } else if (geometry?.type === 'LineString') {
    coordinates = geometry.coordinates;
  }

  if (!coordinates.length) {
    throw new Error('Geoapify routing response had no usable geometry');
  }

  // GeoJSON coordinates are [lon, lat], the opposite of this app's convention.
  return coordinates.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
}

// Walking directions between an ordered list of points, following real
// streets. Provider is switchable via EXPO_PUBLIC_DIRECTIONS_PROVIDER
// ('google' | 'geoapify') so this doesn't hard-depend on Google. Falls back
// to the original straight-line points if the request fails, so the map
// still shows something rather than nothing.
export async function fetchWalkingRoute(
  points: { latitude: number; longitude: number }[]
): Promise<{ latitude: number; longitude: number }[]> {
  if (points.length < 2) return points;

  try {
    return process.env.EXPO_PUBLIC_DIRECTIONS_PROVIDER === 'geoapify'
      ? await fetchWalkingRouteFromGeoapify(points)
      : await fetchWalkingRouteFromGoogle(points);
  } catch (error) {
    console.error('Failed to fetch walking directions, using straight line:', error);
    return points;
  }
}
