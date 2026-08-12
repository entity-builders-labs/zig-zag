export const API_CONFIG = {
  BASE_URL: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000',
  TIMEOUT: 10000,
  HEADERS: {
    //    'Content-Type': 'application/json',
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
  console.log('API_URL', process.env.EXPO_PUBLIC_API_URL);
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
