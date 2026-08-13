import { test, expect, Locator, Page } from '@playwright/test';
import { API_URL } from './playwright.config';
import { loginViaUI } from './auth-helper';

// E2E_DEMO=1 trades speed for looking like an actual person clicking
// through the app — a visible cursor, letter-by-letter typing, and pauses
// to "read" each screen — for recording a walkthrough video. Off by
// default so normal runs (CI, quick local checks) stay fast.
const DEMO = !!process.env.E2E_DEMO;

async function showCursor(page: Page) {
  if (!DEMO) return;
  await page.addInitScript(() => {
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;top:0;left:0;width:20px;height:20px;border-radius:50%;' +
      'background:rgba(239,68,68,0.85);border:2px solid #fff;' +
      'box-shadow:0 1px 6px rgba(0,0,0,0.45);pointer-events:none;' +
      'z-index:2147483647;transform:translate(-999px,-999px);will-change:transform;';
    const attach = () => document.body && document.body.appendChild(dot);
    document.addEventListener('DOMContentLoaded', attach);
    attach();
    window.addEventListener(
      'mousemove',
      (e) => {
        dot.style.transform = `translate(${e.clientX - 10}px, ${e.clientY - 10}px)`;
      },
      { passive: true }
    );
  });
}

// Glides the (visible, in demo mode) cursor to the element before clicking,
// instead of teleporting straight to it.
async function humanClick(page: Page, locator: Locator) {
  if (DEMO) {
    const box = await locator.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 20,
      });
      await page.waitForTimeout(150 + Math.random() * 150);
    }
  }
  await locator.click();
}

async function humanType(locator: Locator, text: string) {
  if (DEMO) {
    await locator.pressSequentially(text, { delay: 45 + Math.random() * 35 });
  } else {
    await locator.fill(text);
  }
}

async function readingPause(page: Page, ms: number) {
  if (DEMO) await page.waitForTimeout(ms);
}

// Drives the entire "create a tour" journey through the real UI — home →
// wizard (destination, dates, budget, company, pace, transport, interests)
// → generation → list view → map view — instead of creating a tour via the
// API directly. This is the actual path a user follows, and it's the only
// way to catch UI-wiring bugs (e.g. a field that's captured but never sent).
test('@live creates a tour end-to-end through the wizard and views it in both list and map mode', async ({
  page,
}) => {
  test.setTimeout(180_000); // headroom for a possible rate-limit retry, see below
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: -34.6037, longitude: -58.3816 });
  await showCursor(page);

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  // --- Login -> Home -> wizard ---
  await loginViaUI(page);
  await readingPause(page, 1200);
  await humanClick(page, page.getByTestId('create-tour-fab'));
  await expect(page).toHaveURL(/\/tours\/wizard/);
  await expect(page.getByText('Paso 1/3: Destino y Fechas')).toBeVisible();
  await readingPause(page, 800);

  // --- Step 1: destination + dates ---
  await humanType(page.getByPlaceholder('Buscar destino'), 'Caminito La Boca');
  // Exact formatting differs by provider (Google omits the postcode Geoapify
  // includes, e.g.) — match loosely so this doesn't hard-depend on either.
  // Multiple real suggestions can match ("Caminito" the street vs. a nearby
  // "Caminito, Avenida ..." landmark) — the first is fine, any real result works.
  const suggestion = page.getByText(/Caminito.*La Boca.*Buenos Aires/).first();
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await readingPause(page, 500);
  await humanClick(page, suggestion);
  // Destination resolved to a real place — the "pick a suggestion" warning
  // must not be showing, and the wizard should let us move on.
  await expect(
    page.getByText('Elegí una opción de la lista para confirmar el destino')
  ).toHaveCount(0);
  await readingPause(page, 600);

  await humanClick(page, page.getByPlaceholder('Seleccionar fechas'));
  await readingPause(page, 500);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const toDateStr = (d: Date) => d.toISOString().split('T')[0];
  await humanClick(page, page.getByTestId(`date-picker-day-${toDateStr(today)}`));
  await readingPause(page, 300);
  await humanClick(page, page.getByTestId(`date-picker-day-${toDateStr(tomorrow)}`));
  await readingPause(page, 400);
  await humanClick(page, page.getByText('Confirmar').first());
  await readingPause(page, 700);

  await humanClick(page, page.getByText('Siguiente →').first());

  // --- Step 2: budget, company, pace, transport ---
  await expect(page.getByText('Paso 2/3: Define tu estilo')).toBeVisible();
  await readingPause(page, 900);

  await humanClick(page, page.getByText('$$', { exact: true }).first()); // budget: medium
  await readingPause(page, 400);
  await humanClick(page, page.getByText('Familia', { exact: true }).first()); // group type
  await readingPause(page, 500);

  // Pace is a WAI-ARIA slider — a layout wrapper overlaps its hit area, so
  // focus() (bypasses hit-testing) + keyboard is more reliable than click().
  const paceSlider = page.getByRole('slider');
  await paceSlider.focus();
  await paceSlider.press('End');
  await readingPause(page, 500);

  await humanClick(page, page.getByText('Público', { exact: true }).first()); // + public transport
  await readingPause(page, 800);

  await humanClick(page, page.getByText('Siguiente →').first());

  // --- Step 3: interests + notes ---
  await expect(page.getByText('Paso 3/3: Personalización IA')).toBeVisible();
  await readingPause(page, 900);

  await humanClick(page, page.getByText('Historia', { exact: true }).last());
  await readingPause(page, 250);
  await humanClick(page, page.getByText('Comida', { exact: true }).last());
  await readingPause(page, 250);
  await humanClick(page, page.getByText('Cultura', { exact: true }).last());
  await readingPause(page, 500);
  await humanType(
    page.getByPlaceholder('Escribe aquí... (ej. Soy vegano...)'),
    'Me interesa la historia del tango'
  );
  await readingPause(page, 900);

  await humanClick(page, page.getByText('Generar ZigZag ✨').first());

  // --- Generation ---
  await page.waitForURL(/\/tours\/[a-f0-9-]+$/, { timeout: 15_000 });
  const tourId = page.url().split('/tours/')[1];

  // The tour starts in "generating" state; wait it out (real AI + route
  // optimization call), then land on either real stops or a clear failure
  // message — never an indefinite spinner (see tour-activity-generation
  // service's atomic status update fix).
  const waitForGenerationToSettle = () =>
    expect(async () => {
      const stillGenerating = await page
        .getByText(/Generando|Esto puede tomar unos momentos/)
        .count();
      expect(stillGenerating).toBe(0);
    }).toPass({ timeout: 30_000, intervals: [2000] });

  await waitForGenerationToSettle();

  // Groq (this project's AI_PROVIDER, on a free/rate-limited plan) 429s if
  // called again too soon after another generation — a real quota limit,
  // not a bug, and not worth padding every run with a fixed wait for. Only
  // pay the cost when it actually happens: back off and retry generation
  // through the same endpoint the app itself uses to recover.
  for (let attempt = 0; attempt < 2; attempt++) {
    const rateLimited = await page.getByText(/429|rate.?limit/i).count();
    if (rateLimited === 0) break;
    await page.waitForTimeout(25_000);
    await page.request.post(`${API_URL}/tours/${tourId}/generate-activities`);
    await page.reload();
    await waitForGenerationToSettle();
  }

  // The "generating" text and the failure message are set in the same poll
  // tick but aren't guaranteed to paint in the same instant — without this,
  // toHaveCount(0) can win a race against React finishing the failure render.
  await page.waitForTimeout(500);
  await expect(page.getByText('No pudimos generar este tour')).toHaveCount(0);

  // --- List mode (default) ---
  await expect(page.getByText('Tu Recorrido')).toBeVisible();
  const stopCards = page.locator('text=Caminata').first();
  await expect(stopCards.or(page.getByText('Free'))).toBeVisible();
  await readingPause(page, 2500); // hold on list mode so it reads clearly on video

  // --- Map mode ---
  await humanClick(page, page.getByTestId('view-toggle-map'));
  await expect(page.locator('.gm-style')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const polylines = (window as any).__zigzagPolylines;
      return Array.isArray(polylines) && polylines.length > 0;
    },
    { timeout: 15_000 }
  );
  await readingPause(page, 3000); // hold on map mode so the route is visible on video

  expect(consoleErrors).toEqual([]);
});
