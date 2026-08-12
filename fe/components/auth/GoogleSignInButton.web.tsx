import { useEffect, useRef } from 'react';
import { Box, Text } from '@gluestack-ui/themed';

type Props = {
  disabled: boolean;
  loading: boolean;
  onSignIn: (idToken?: string) => Promise<void>;
  onError: (message: string) => void;
};

type GoogleIdentity = {
  initialize: (options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: Record<string, string | number>,
  ) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

const SCRIPT_ID = 'google-identity-services';

async function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return window.google.accounts.id;

  let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  await new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    script!.addEventListener('load', () => resolve(), { once: true });
    script!.addEventListener(
      'error',
      () => reject(new Error('No se pudo cargar Google Identity Services')),
      { once: true },
    );
  });

  if (!window.google?.accounts?.id) {
    throw new Error('Google Identity Services no está disponible');
  }
  return window.google.accounts.id;
}

export function GoogleSignInButton({
  disabled,
  loading,
  onSignIn,
  onError,
}: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!clientId) {
      onError('Falta configurar el Client ID de Google para web');
      return;
    }

    let active = true;
    loadGoogleIdentity()
      .then((google) => {
        if (!active || !container.current) return;
        google.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            if (credential) void onSignIn(credential);
          },
        });
        container.current.replaceChildren();
        google.renderButton(container.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
        });
      })
      .catch((error: Error) => active && onError(error.message));

    return () => {
      active = false;
    };
  }, [onError, onSignIn]);

  return (
    <Box alignItems='center' opacity={disabled ? 0.6 : 1}>
      <div
        ref={container}
        data-testid='login-google-button'
        style={{ pointerEvents: disabled ? 'none' : 'auto', minHeight: 44 }}
      />
      {loading && <Text size='xs'>Iniciando sesión…</Text>}
    </Box>
  );
}
