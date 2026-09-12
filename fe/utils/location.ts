import * as Location from 'expo-location';
import { Alert, Platform } from 'react-native';
import { DEFAULT_LOCATION } from '@/api/config/constants';

export interface LocationCoords {
  lat: number;
  lng: number;
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
 * Requests location permission if not already granted and retrieves the device coordinates.
 * Incorporates fast path (getLastKnownPosition) and fallback to avoid hanging or throwing
 * ERR_CURRENT_LOCATION_IS_UNAVAILABLE on Android emulators or devices without immediate GPS fix.
 */
export async function requestAndGetCurrentLocation(options?: {
  showPromptOnDenial?: boolean;
}): Promise<LocationCoords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      if (options?.showPromptOnDenial) {
        Alert.alert(
          'Permiso de Ubicación',
          'Zig-Zag necesita acceso a tu ubicación para descubrir recorridos y actividades cercanas a vos.'
        );
      }
      return null;
    }

    // 1. Fast path: try to get the last known position first (instant and reliable on emulators)
    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown?.coords?.latitude && lastKnown?.coords?.longitude) {
        return {
          lat: lastKnown.coords.latitude,
          lng: lastKnown.coords.longitude,
        };
      }
    } catch (lastKnownErr) {
      console.log('Last known position not available, trying current position...');
    }

    // 2. Try current position with balanced accuracy
    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (current?.coords?.latitude && current?.coords?.longitude) {
        return {
          lat: current.coords.latitude,
          lng: current.coords.longitude,
        };
      }
    } catch (currentPosErr) {
      console.warn('Current position lookup failed:', currentPosErr);
    }

    // 3. Fallback for emulators without geo fixes: return default Buenos Aires coordinates
    return {
      lat: DEFAULT_LOCATION.LATITUDE,
      lng: DEFAULT_LOCATION.LONGITUDE,
    };
  } catch (error) {
    console.warn('Unexpected error in requestAndGetCurrentLocation:', error);
    return {
      lat: DEFAULT_LOCATION.LATITUDE,
      lng: DEFAULT_LOCATION.LONGITUDE,
    };
  }
}
