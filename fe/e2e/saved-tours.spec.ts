import { test, expect } from '@playwright/test';
import { API_URL } from './playwright.config';
import { apiLogin, seedAuthSession } from './auth-helper';

test('a tour created by the user shows up in the Guardados tab', async ({
  page,
  request,
}) => {
  const session = await apiLogin(request);

  const createResp = await request.post(`${API_URL}/tours/generate-tour`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      destination: 'Caminito, La Boca, Buenos Aires',
      destinationLatitude: -34.6393027,
      destinationLongitude: -58.3627819,
      latitude: -34.6393027,
      longitude: -58.3627819,
      radius: 1000,
      days: 1,
      budgetLevel: 'medium',
      interests: ['culture'],
      transportationMode: ['walking'],
      groupType: 'solo',
      travelPace: 'moderate',
      skipActivities: true, // Guardados only needs the tour to exist, not fully generated
      skipImageGeneration: true,
    },
  });
  expect(createResp.ok()).toBeTruthy();
  const { id: tourId, name: tourName } = await createResp.json();

  await seedAuthSession(page, session);
  await page.goto('/');
  await page.getByTestId('tab-saved').click();

  const savedCard = page.getByTestId(`saved-tour-${tourId}`);
  await expect(savedCard).toBeVisible({ timeout: 10_000 });
  await expect(savedCard).toContainText(tourName);
});

test('Guardados only shows the current user\'s own tours', async ({
  page,
  request,
}) => {
  const otherUser = await apiLogin(request);
  await request.post(`${API_URL}/tours/generate-tour`, {
    headers: { Authorization: `Bearer ${otherUser.accessToken}` },
    data: {
      destination: 'Recoleta, Buenos Aires',
      destinationLatitude: -34.5875,
      destinationLongitude: -58.3936,
      latitude: -34.5875,
      longitude: -58.3936,
      radius: 1000,
      days: 1,
      skipActivities: true,
      skipImageGeneration: true,
    },
  });

  const me = await apiLogin(request);
  await seedAuthSession(page, me);
  await page.goto('/');
  await page.getByTestId('tab-saved').click();

  // The other user's tour must never leak into this session's list.
  await expect(page.getByText('Todavía no creaste ningún tour')).toBeVisible({
    timeout: 10_000,
  });
});
