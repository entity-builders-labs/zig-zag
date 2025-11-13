export const API_CONFIG = {
  BASE_URL: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000',
  TIMEOUT: 10000,
  HEADERS: {
    //    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
} as const;

// Debug log to verify base URL at runtime (development only)
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('API_URL', process.env.EXPO_PUBLIC_API_URL);
}

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
  },
} as const;

export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
} as const;
