import { test, expect } from '@playwright/test';

// Drives the entire "create a tour" journey through the real UI — home →
// wizard (destination, dates, budget, company, pace, transport, interests)
// → generation → list view → map view — instead of creating a tour via the
// API directly. This is the actual path a user follows, and it's the only
// way to catch UI-wiring bugs (e.g. a field that's captured but never sent).
test('creates a tour end-to-end through the wizard and views it in both list and map mode', async ({
  page,
}) => {
  test.setTimeout(180_000); // includes a deliberate 60s pause for the Groq rate limit
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: -34.6037, longitude: -58.3816 });

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  // --- Home -> wizard ---
  await page.goto('/');
  await page.getByTestId('create-tour-fab').click();
  await expect(page).toHaveURL(/\/tours\/wizard/);
  await expect(page.getByText('Paso 1/3: Destino y Fechas')).toBeVisible();

  // --- Step 1: destination + dates ---
  await page.getByPlaceholder('Buscar destino').fill('Caminito La Boca');
  const suggestion = page.getByText('Caminito, La Boca, Buenos Aires, Argentina');
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await suggestion.click();
  // Destination resolved to a real place — the "pick a suggestion" warning
  // must not be showing, and the wizard should let us move on.
  await expect(
    page.getByText('Elegí una opción de la lista para confirmar el destino')
  ).toHaveCount(0);

  await page.getByPlaceholder('Seleccionar fechas').click();
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const toDateStr = (d: Date) => d.toISOString().split('T')[0];
  await page.getByTestId(`date-picker-day-${toDateStr(today)}`).click();
  await page.getByTestId(`date-picker-day-${toDateStr(tomorrow)}`).click();
  await page.getByText('Confirmar').first().click();

  await page.getByText('Siguiente →').first().click();

  // --- Step 2: budget, company, pace, transport ---
  await expect(page.getByText('Paso 2/3: Define tu estilo')).toBeVisible();

  await page.getByText('$$', { exact: true }).first().click(); // budget: medium
  await page.getByText('Familia', { exact: true }).first().click(); // group type

  // Pace is a WAI-ARIA slider — a layout wrapper overlaps its hit area, so
  // focus() (bypasses hit-testing) + keyboard is more reliable than click().
  const paceSlider = page.getByRole('slider');
  await paceSlider.focus();
  await paceSlider.press('End');

  await page.getByText('Público', { exact: true }).first().click(); // + public transport

  await page.getByText('Siguiente →').first().click();

  // --- Step 3: interests + notes ---
  await expect(page.getByText('Paso 3/3: Personalización IA')).toBeVisible();

  await page.getByText('Historia', { exact: true }).last().click();
  await page.getByText('Comida', { exact: true }).last().click();
  await page.getByText('Cultura', { exact: true }).last().click();
  await page
    .getByPlaceholder('Escribe aquí... (ej. Soy vegano...)')
    .fill('Me interesa la historia del tango');

  // Groq (this project's AI_PROVIDER, on a free/rate-limited plan) 429s if
  // called again too soon after another generation — a real quota limit,
  // not a bug. This suite runs with workers: 1 and this test always runs
  // after tour-detail-map.spec.ts's own generation call, so pad the gap
  // before triggering ours.
  await page.waitForTimeout(60_000);

  await page.getByText('Generar ZigZag ✨').first().click();

  // --- Generation ---
  await page.waitForURL(/\/tours\/[a-f0-9-]+$/, { timeout: 15_000 });

  // The tour starts in "generating" state; wait it out (real AI + route
  // optimization call), then land on either real stops or a clear failure
  // message — never an indefinite spinner (see tour-activity-generation
  // service's atomic status update fix).
  await expect(async () => {
    const stillGenerating = await page
      .getByText(/Generando|Esto puede tomar unos momentos/)
      .count();
    expect(stillGenerating).toBe(0);
  }).toPass({ timeout: 60_000, intervals: [2000] });

  await expect(page.getByText('No pudimos generar este tour')).toHaveCount(0);

  // --- List mode (default) ---
  await expect(page.getByText('Tu Recorrido')).toBeVisible();
  const stopCards = page.locator('text=Caminata').first();
  await expect(stopCards.or(page.getByText('Free'))).toBeVisible();

  // --- Map mode ---
  await page.getByTestId('view-toggle-map').click();
  await expect(page.locator('.gm-style')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const polylines = (window as any).__zigzagPolylines;
      return Array.isArray(polylines) && polylines.length > 0;
    },
    { timeout: 15_000 }
  );

  expect(consoleErrors).toEqual([]);
});
