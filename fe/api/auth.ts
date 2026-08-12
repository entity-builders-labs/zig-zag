import axiosInstance from './config/axios';
import { API_ENDPOINTS } from './config/constants';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export async function loginWithGoogle(idToken: string) {
  const { data } = await axiosInstance.post<AuthSession>(
    API_ENDPOINTS.AUTH.GOOGLE,
    { idToken }
  );
  return data;
}

export async function loginWithApple(identityToken: string, fullName?: string) {
  const { data } = await axiosInstance.post<AuthSession>(
    API_ENDPOINTS.AUTH.APPLE,
    { identityToken, fullName }
  );
  return data;
}

export async function requestEmailCode(email: string) {
  const { data } = await axiosInstance.post<{ message: string; devCode?: string }>(
    API_ENDPOINTS.AUTH.EMAIL_REQUEST_CODE,
    { email }
  );
  return data;
}

export async function verifyEmailCode(email: string, code: string) {
  const { data } = await axiosInstance.post<AuthSession>(
    API_ENDPOINTS.AUTH.EMAIL_VERIFY,
    { email, code }
  );
  return data;
}

export async function refreshSession(refreshToken: string) {
  const { data } = await axiosInstance.post<AuthSession>(
    API_ENDPOINTS.AUTH.REFRESH,
    { refreshToken }
  );
  return data;
}

export async function logout() {
  await axiosInstance.post(API_ENDPOINTS.AUTH.LOGOUT);
}

export async function fetchCurrentUser() {
  const { data } = await axiosInstance.get<AuthUser>(API_ENDPOINTS.AUTH.ME);
  return data;
}
