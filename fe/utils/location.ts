import * as Location from 'expo-location';
import { Alert } from 'react-native';

export interface LocationCoords {
  lat: number;
  lng: number;
}

const CURRENT_POSITION_TIMEOUT_MS = 8_000;

function isValidCoordinate(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function toLocationCoords(
  position: Location.LocationObject | null | undefined,
): LocationCoords | null {
  const latitude = position?.coords?.latitude;
  const longitude = position?.coords?.longitude;

  if (
    !isValidCoordinate(latitude, -90, 90) ||
    !isValidCoordinate(longitude, -180, 180)
  ) {
    return null;
  }

  return { lat: latitude, lng: longitude };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Location lookup timed out')), timeoutMs);
    }),
  ]);
}

/**
 * Checks if foreground location permission is currently granted without prompting.
 */
export async function checkLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.warn('Error checking location permission:', error);
    return false;
  }
}

/**
 * Requests foreground location permission and retrieves the device coordinates.
 *
 * Important: failure to obtain a real device fix returns `null`. It never falls
 * back to the app's default map center, because callers label this result as the
 * user's current location. A product/default center must be chosen explicitly by
 * the caller instead of being disguised as GPS truth.
 */
export async function requestAndGetCurrentLocation(options?: {
  showPromptOnDenial?: boolean;
  showPromptOnUnavailable?: boolean;
}): Promise<LocationCoords | null> {
  // Explicit user actions that ask to show a denial prompt should also explain
  // an unavailable GPS fix unless the caller overrides that behavior. Silent
  // calls (for example initial best-effort positioning) remain silent.
  const showUnavailable =
    options?.showPromptOnUnavailable ?? options?.showPromptOnDenial ?? false;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      if (options?.showPromptOnDenial) {
        Alert.alert(
          'Permiso de Ubicación',
          'Zig-Zag necesita acceso a tu ubicación para descubrir recorridos y actividades cercanas a vos.',
        );
      }
      return null;
    }

    // Fast path: a last-known position is useful on emulators and devices
    // while a fresh fix is still warming up. Latitude/longitude === 0 are
    // valid coordinates and must not be rejected by truthiness checks.
    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      const coords = toLocationCoords(lastKnown);
      if (coords) return coords;
    } catch (error) {
      console.log('Last known position not available, trying current position...');
    }

    try {
      const current = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        CURRENT_POSITION_TIMEOUT_MS,
      );
      const coords = toLocationCoords(current);
      if (coords) return coords;
    } catch (error) {
      console.warn('Current position lookup failed:', error);
    }

    if (showUnavailable) {
      Alert.alert(
        'Ubicación no disponible',
        'No pudimos obtener tu ubicación actual. Podés elegir un destino o intentarlo nuevamente.',
      );
    }
    return null;
  } catch (error) {
    console.warn('Unexpected error in requestAndGetCurrentLocation:', error);
    if (showUnavailable) {
      Alert.alert(
        'Ubicación no disponible',
        'No pudimos obtener tu ubicación actual. Podés elegir un destino o intentarlo nuevamente.',
      );
    }
    return null;
  }
}
