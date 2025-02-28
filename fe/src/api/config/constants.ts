export const API_CONFIG = {
BASE_URL: 'http://localhost:3000',
TIMEOUT: 10000,
HEADERS: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
},
} as const;

export const API_ENDPOINTS = {
AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
},
} as const;

export const STORAGE_KEYS = {
AUTH_TOKEN: 'auth_token',
} as const;

