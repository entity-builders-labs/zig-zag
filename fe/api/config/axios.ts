import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { API_CONFIG, API_ENDPOINTS } from './constants';
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from './token-storage';

export const axiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: API_CONFIG.HEADERS,
});

// AuthProvider registers this so a dead refresh token (expired/revoked) can
// clear its in-memory session and redirect to login, without this module
// needing to import the context (would be circular: context calls this API).
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

axiosInstance.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Concurrent 401s share a single in-flight refresh instead of each firing
// their own — avoids racing multiple refresh calls against the same
// single-use, rotating refresh token.
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    // Plain axios, not axiosInstance: going through axiosInstance would
    // re-enter this same response interceptor if the refresh call itself
    // ever came back 401, recursing indefinitely.
    const { data } = await axios.post<{
      accessToken: string;
      refreshToken: string;
    }>(`${API_CONFIG.BASE_URL}${API_ENDPOINTS.AUTH.REFRESH}`, {
      refreshToken,
    });
    await setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    await clearTokens();
    return null;
  }
}

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;
    const isAuthEndpoint = originalRequest?.url?.startsWith('/auth/');

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isAuthEndpoint
    ) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccessToken = await refreshPromise;

      if (newAccessToken) {
        originalRequest.headers = originalRequest.headers ?? ({} as any);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return axiosInstance(originalRequest);
      }

      await clearTokens();
      onSessionExpired?.();
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
