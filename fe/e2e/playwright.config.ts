import { defineConfig } from '@playwright/test';

// Points at an already-running instance of the app + backend — this repo's
// dev workflow serves the web build separately (see CLAUDE.md / README),
// so this config does not spawn a webServer itself. Override with env vars
// to point at a different environment.
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 0,
  // These tests create real tours against a rate-limited AI provider (Groq)
  // — running them in parallel workers reliably triggers 429s that have
  // nothing to do with the app itself.
  workers: 1,
  use: {
    baseURL: process.env.E2E_WEB_URL || 'http://localhost:19006',
    screenshot: 'only-on-failure',
    // Runs headless by default; the video is the evidence trail instead of
    // a live window. 'retain-on-failure' skips saving one for passing runs —
    // set E2E_VIDEO=on to always keep it (e.g. to watch a passing run back).
    video: (process.env.E2E_VIDEO as any) || 'retain-on-failure',
    trace: 'retain-on-failure',
    // E2E_SLOWMO=1 (with --headed) paces every action so you can actually
    // watch the test drive the browser, instead of it flashing by in ~5s.
    launchOptions: process.env.E2E_SLOWMO
      ? { slowMo: 400 }
      : undefined,
  },
});

export const API_URL = process.env.E2E_API_URL || 'http://localhost:4000';
