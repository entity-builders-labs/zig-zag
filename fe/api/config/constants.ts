import Constants from 'expo-constants';
import { Platform } from 'react-native';

const getBaseUrl = () => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  
  // If running on a mobile device and envUrl is localhost or empty,
  // dynamically resolve the Metro bundler host IP (e.g. 192.168.68.109)
  if (Platform.OS !== 'web') {
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const ip = hostUri.split(':')[0];
      return `http://${ip}:4000`;
    }
  }

  return envUrl || 'http://localhost:4000';
};

export const API_CONFIG = {
  BASE_URL: getBaseUrl(),
  TIMEOUT: 10000,
  HEADERS: {
    Accept: 'application/json',
  },
} as const;

export const DEFAULT_LOCATION = {
  LATITUDE: -34.5209462,
  LONGITUDE: -58.4972602,
} as const;

// Debug log to verify base URL at runtime (development only)
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('API_URL resolved to:', API_CONFIG.BASE_URL);
}

export const API_ENDPOINTS = {
  AUTH: {
    GOOGLE: '/auth/google',
    APPLE: '/auth/apple',
    EMAIL_REQUEST_CODE: '/auth/email/request-code',
    EMAIL_VERIFY: '/auth/email/verify',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
  },
} as const;

export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const;
