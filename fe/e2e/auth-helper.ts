import { APIRequestContext, Page, expect } from '@playwright/test';
import { API_URL } from './playwright.config';

export function uniqueTestEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Logs in through the real login screen (email + one-time code). Reads the
 * code from the `devCode` the backend echoes back outside production — there
 * is no real inbox to read from in E2E, and automating real Google/Apple
 * OAuth isn't practical here. Leaves the page on '/' once authenticated.
 */
export async function loginViaUI(
  page: Page,
  email: string = uniqueTestEmail()
): Promise<string> {
  await page.goto('/');
  await page.waitForURL(/\/login$/, { timeout: 15_000 });

  await page.getByTestId('login-email-link').click();
  await page.getByTestId('login-email-input').fill(email);
  await page.getByTestId('login-request-code-button').click();

  const devCodeBox = page.getByText(/Modo desarrollo — código: \d{6}/);
  await expect(devCodeBox).toBeVisible({ timeout: 10_000 });
  const code = (await devCodeBox.textContent())?.match(/\d{6}/)?.[0];
  if (!code) {
    throw new Error(
      'devCode not found on the login screen — is the backend running with NODE_ENV=production?'
    );
  }

  await page.getByTestId('login-code-input').fill(code);
  await page.getByTestId('login-verify-code-button').click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', {
    timeout: 15_000,
  });

  return email;
}

/**
 * Logs in via raw HTTP, for tests that create fixtures through the API
 * request context rather than the browser page.
 */
export async function apiLogin(
  request: APIRequestContext,
  email: string = uniqueTestEmail()
): Promise<{ email: string; accessToken: string; refreshToken: string }> {
  const requestResp = await request.post(`${API_URL}/auth/email/request-code`, {
    data: { email },
  });
  expect(requestResp.ok()).toBeTruthy();
  const { devCode } = await requestResp.json();
  if (!devCode) {
    throw new Error(
      'devCode not returned by /auth/email/request-code — is the backend running with NODE_ENV=production?'
    );
  }

  const verifyResp = await request.post(`${API_URL}/auth/email/verify`, {
    data: { email, code: devCode },
  });
  expect(verifyResp.ok()).toBeTruthy();
  const session = await verifyResp.json();

  return {
    email,
    accessToken: session.accessToken as string,
    refreshToken: session.refreshToken as string,
  };
}

/**
 * Seeds an already-authenticated session into the browser page (web build
 * stores tokens in localStorage — see fe/api/config/token-storage.ts), for
 * tests that need a logged-in browser session for a user created via
 * apiLogin without re-driving the login UI (which would trigger the same
 * email's request-code cooldown twice in quick succession).
 */
export async function seedAuthSession(
  page: Page,
  session: { accessToken: string; refreshToken: string }
): Promise<void> {
  await page.addInitScript(
    ({ accessToken, refreshToken }) => {
      window.localStorage.setItem('access_token', accessToken);
      window.localStorage.setItem('refresh_token', refreshToken);
    },
    { accessToken: session.accessToken, refreshToken: session.refreshToken }
  );
}
