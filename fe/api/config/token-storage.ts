import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './constants';

// expo-secure-store requires native Keychain entitlements which may be unavailable
// on local unsigned simulators or web. Fall back gracefully to AsyncStorage.
let secureStoreModule: typeof import('expo-secure-store') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  secureStoreModule = require('expo-secure-store');
} catch {
  secureStoreModule = null;
}

const isNativeSecureAvailable = (): boolean => {
  return (Platform.OS === 'ios' || Platform.OS === 'android') && secureStoreModule != null;
};

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }

  if (isNativeSecureAvailable()) {
    try {
      return await secureStoreModule!.getItemAsync(key);
    } catch (error) {
      if (__DEV__) {
        console.warn(`[TokenStorage] SecureStore.getItemAsync failed in DEV; falling back to AsyncStorage:`, error);
        return AsyncStorage.getItem(key);
      }
      throw error;
    }
  }

  if (__DEV__) {
    return AsyncStorage.getItem(key);
  }
  throw new Error('[TokenStorage] SecureStore is unavailable in production mobile build');
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.setItem(key, value);
  }

  if (isNativeSecureAvailable()) {
    try {
      await secureStoreModule!.setItemAsync(key, value);
      return;
    } catch (error) {
      if (__DEV__) {
        console.warn(`[TokenStorage] SecureStore.setItemAsync failed in DEV; falling back to AsyncStorage:`, error);
        return AsyncStorage.setItem(key, value);
      }
      throw error;
    }
  }

  if (__DEV__) {
    return AsyncStorage.setItem(key, value);
  }
  throw new Error('[TokenStorage] SecureStore is unavailable in production mobile build');
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.removeItem(key);
  }

  if (isNativeSecureAvailable()) {
    try {
      await secureStoreModule!.deleteItemAsync(key);
      return;
    } catch (error) {
      if (__DEV__) {
        console.warn(`[TokenStorage] SecureStore.deleteItemAsync failed in DEV; falling back to AsyncStorage:`, error);
        return AsyncStorage.removeItem(key);
      }
      throw error;
    }
  }

  if (__DEV__) {
    return AsyncStorage.removeItem(key);
  }
  throw new Error('[TokenStorage] SecureStore is unavailable in production mobile build');
}

export async function getAccessToken(): Promise<string | null> {
  return getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

export async function getRefreshToken(): Promise<string | null> {
  return getItem(STORAGE_KEYS.REFRESH_TOKEN);
}

export async function setTokens(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await Promise.all([
    setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken),
    setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    removeItem(STORAGE_KEYS.ACCESS_TOKEN),
    removeItem(STORAGE_KEYS.REFRESH_TOKEN),
  ]);
}
