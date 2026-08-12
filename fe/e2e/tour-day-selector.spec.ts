import { test, expect } from '@playwright/test';
import { API_URL } from './playwright.config';
import { apiLogin, seedAuthSession } from './auth-helper';

// Built directly via POST /tours (not /generate-tour) with pre-set
// dayNumber/order on each stop — deterministic and doesn't touch the AI
// provider, since this is testing the day-selector UI, not generation.
async function createTwoDayTour(
  request: import('@playwright/test').APIRequestContext,
  accessToken: string
): Promise<string> {
  const resp = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      name: 'Two-day test tour',
      description: 'E2E fixture for the map day selector',
      totalDays: 2,
      activities: [
        {
          activityName: 'Day 1 Stop A',
          activityType: 'cultural',
          activityLatitude: -34.6393027,
          activityLongitude: -58.3627819,
          dayNumber: 1,
          order: 1,
        },
        {
          activityName: 'Day 1 Stop B',
          activityType: 'cultural',
          activityLatitude: -34.6383,
          activityLongitude: -58.3617,
          dayNumber: 1,
          order: 2,
        },
        {
          activityName: 'Day 2 Stop A',
          activityType: 'cultural',
          activityLatitude: -34.6218351,
          activityLongitude: -58.3713942,
          dayNumber: 2,
          order: 1,
        },
        {
          activityName: 'Day 2 Stop B',
          activityType: 'cultural',
          activityLatitude: -34.6208,
          activityLongitude: -58.3703,
          dayNumber: 2,
          order: 2,
        },
      ],
    },
  });
  expect(resp.ok()).toBeTruthy();
  const { id } = await resp.json();
  return id;
}

test('the map lets you switch between days on a multi-day tour', async ({
  page,
  request,
}) => {
  const session = await apiLogin(request);
  const tourId = await createTwoDayTour(request, session.accessToken);

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('view-toggle-map').click();
  await expect(page.locator('.gm-style')).toBeVisible({ timeout: 15_000 });

  const day1Pill = page.getByTestId('tour-day-1');
  const day2Pill = page.getByTestId('tour-day-2');
  await expect(day1Pill).toBeVisible();
  await expect(day2Pill).toBeVisible();

  // Day 1 is selected by default — its route should be drawn already.
  await page.waitForFunction(
    () => {
      const polylines = (window as any).__zigzagPolylines;
      return Array.isArray(polylines) && polylines.length > 0;
    },
    { timeout: 15_000 }
  );
  const day1Path = await page.evaluate(() =>
    (window as any).__zigzagPolylines[0].getPath().getArray().map((p: any) => p.lat())
  );

  await day2Pill.click();

  // Switching days re-fetches the route — wait for the polyline's points to
  // actually change rather than just "exist", so this can't pass on a stale
  // day-1 route that never got replaced.
  await page.waitForFunction(
    (previousFirstLat: number) => {
      const polylines = (window as any).__zigzagPolylines;
      if (!Array.isArray(polylines) || polylines.length === 0) return false;
      const path = polylines[0].getPath().getArray();
      return path.length > 0 && path[0].lat() !== previousFirstLat;
    },
    day1Path[0],
    { timeout: 15_000 }
  );
});

test('a single-day tour shows no day selector', async ({ page, request }) => {
  const session = await apiLogin(request);
  const resp = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      name: 'One-day test tour',
      totalDays: 1,
      activities: [
        {
          activityName: 'Only Stop',
          activityType: 'cultural',
          activityLatitude: -34.6393027,
          activityLongitude: -58.3627819,
          dayNumber: 1,
          order: 1,
        },
      ],
    },
  });
  expect(resp.ok()).toBeTruthy();
  const { id: tourId } = await resp.json();

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('view-toggle-map').click();
  await expect(page.locator('.gm-style')).toBeVisible({ timeout: 15_000 });

  await expect(page.getByTestId('tour-day-1')).toHaveCount(0);
});
