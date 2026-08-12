import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './constants';

// expo-secure-store has no web implementation, so tokens fall back to
// AsyncStorage there — the web build already trusts localStorage-backed
// AsyncStorage for other data, and there's no OS keychain to defer to anyway.
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

async function getItem(key: string): Promise<string | null> {
  return isNative ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
}

async function setItem(key: string, value: string): Promise<void> {
  return isNative
    ? SecureStore.setItemAsync(key, value)
    : AsyncStorage.setItem(key, value);
}

async function removeItem(key: string): Promise<void> {
  return isNative
    ? SecureStore.deleteItemAsync(key)
    : AsyncStorage.removeItem(key);
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
