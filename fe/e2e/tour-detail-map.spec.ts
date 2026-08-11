import { test, expect, APIRequestContext } from '@playwright/test';
import { API_URL } from './playwright.config';

// Generates a real tour (with real, crawled activities — see
// be/src/modules/tours/services/tour-activity-generation.service.ts) near a
// known-good location, then waits for background generation to finish.
async function createTestTour(request: APIRequestContext): Promise<string> {
  const createResp = await request.post(`${API_URL}/tours/generate-tour`, {
    data: {
      destination: 'Caminito, La Boca, Buenos Aires',
      destinationLatitude: -34.6393027,
      destinationLongitude: -58.3627819,
      latitude: -34.6393027,
      longitude: -58.3627819,
      radius: 1000,
      days: 1,
      budgetLevel: 'medium',
      interests: ['culture', 'art', 'history'],
      transportationMode: ['walking'],
      groupType: 'solo',
      travelPace: 'moderate',
      includeExistingActivities: true,
      skipImageGeneration: true,
    },
  });
  expect(createResp.ok()).toBeTruthy();
  const { id } = await createResp.json();

  for (let attempt = 0; attempt < 20; attempt++) {
    const tourResp = await request.get(`${API_URL}/tours/${id}`);
    const tour = await tourResp.json();
    const status = tour.metadata?.generationStatus;
    if (status === 'completed' && tour.activities?.length > 1) return id;
    if (status === 'failed') {
      throw new Error(`Tour generation failed: ${tour.metadata?.generationError}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Tour generation did not complete in time');
}

test('tour detail map shows a real walking route between stops', async ({
  page,
  request,
}) => {
  const tourId = await createTestTour(request);

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('view-toggle-map').click();

  // Modern Google Maps renders polylines via WebGL/canvas, not SVG DOM
  // nodes, so there's nothing to query for in the page itself. The Map
  // component exposes its live google.maps.Polyline instances on
  // window.__zigzagPolylines specifically so tests can assert against them.
  await expect(page.locator('.gm-style')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const polylines = (window as any).__zigzagPolylines;
      return (
        Array.isArray(polylines) &&
        polylines.length > 0 &&
        polylines[0].getPath().getLength() > 1
      );
    },
    { timeout: 15_000 }
  );

  expect(consoleErrors).toEqual([]);

  // Give a --headed run time to actually look at the result before the
  // browser closes.
  if (process.env.E2E_SLOWMO) {
    await page.waitForTimeout(5000);
  }
});
