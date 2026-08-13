import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Platform } from 'react-native';
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as authApi from '../api/auth';
import { AuthSession, AuthUser } from '../api/auth';
import {
  getAccessToken,
  setTokens,
  clearTokens,
} from '../api/config/token-storage';
import { setSessionExpiredHandler } from '../api/config/axios';

export type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signInWithGoogle: (webIdToken?: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  requestEmailCode: (email: string) => Promise<{ devCode?: string }>;
  signInWithEmailCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
  requestEmailCode: async () => ({}),
  signInWithEmailCode: async () => {},
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback(async (session: AuthSession) => {
    await setTokens(session.accessToken, session.refreshToken);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Best-effort — the local session is cleared either way.
    }
    await clearTokens();
    setUser(null);
  }, []);

  // Lets the axios layer clear the in-memory user when a refresh ultimately
  // fails (dead/revoked refresh token), without axios.ts importing this
  // context module (would be circular — this file imports axios.ts's client).
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await authApi.fetchCurrentUser();
        setUser(me);
      } catch {
        await clearTokens();
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signInWithGoogle = useCallback(async (webIdToken?: string) => {
    if (Platform.OS === 'web') {
      if (!webIdToken) {
        throw new Error('Google no devolvió un token de identidad');
      }
      const session = await authApi.loginWithGoogle(webIdToken);
      await applySession(session);
      return;
    }

    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    });
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response) || !response.data.idToken) {
      throw new Error('No se pudo completar el login con Google');
    }
    const session = await authApi.loginWithGoogle(response.data.idToken);
    await applySession(session);
  }, [applySession]);

  const signInWithApple = useCallback(async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new Error('No se pudo completar el login con Apple');
    }
    // Apple only sends the name on the very first authorization — the
    // backend can't recover it from the token on later logins, so it must
    // ride along here while it's available.
    const fullName = credential.fullName
      ? AppleAuthentication.formatFullName(credential.fullName)
      : undefined;
    const session = await authApi.loginWithApple(
      credential.identityToken,
      fullName || undefined,
    );
    await applySession(session);
  }, [applySession]);

  const requestEmailCode = useCallback(async (email: string) => {
    const result = await authApi.requestEmailCode(email);
    return { devCode: result.devCode };
  }, []);

  const signInWithEmailCode = useCallback(
    async (email: string, code: string) => {
      const session = await authApi.verifyEmailCode(email, code);
      await applySession(session);
    },
    [applySession],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        signInWithGoogle,
        signInWithApple,
        requestEmailCode,
        signInWithEmailCode,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
