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

// Walking directions between an ordered list of points, following real
// streets — via the Google Directions API (proxied through cors-proxy to
// avoid exposing the key / CORS issues). Falls back to the original
// straight-line points if the request fails, so the map still shows
// something rather than nothing.
export async function fetchWalkingRoute(
  points: { latitude: number; longitude: number }[]
): Promise<{ latitude: number; longitude: number }[]> {
  if (points.length < 2) return points;

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

  const baseUrl =
    process.env.EXPO_PUBLIC_CORS_PROXY_URL || 'http://localhost:8080';

  try {
    const resp = await fetch(
      `${baseUrl}/proxy/maps/api/directions/json?${params.toString()}`
    );
    if (!resp.ok) throw new Error(`Directions request failed: ${resp.status}`);
    const data = await resp.json();

    if (data.status !== 'OK' || !data.routes?.[0]?.overview_polyline?.points) {
      throw new Error(`Directions API error: ${data.status}`);
    }

    return decodePolyline(data.routes[0].overview_polyline.points);
  } catch (error) {
    console.error('Failed to fetch walking directions, using straight line:', error);
    return points;
  }
}
