import { test, expect } from '@playwright/test';
import { API_URL } from './playwright.config';
import { apiLogin, seedAuthSession } from './auth-helper';

test('a tour created by the user shows up in the Guardados tab', async ({
  page,
  request,
}) => {
  const session = await apiLogin(request);

  const createResp = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      name: 'Tour Guardados Fixture',
      description: 'Caminito, La Boca, Buenos Aires',
      totalDays: 1,
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
  const otherResp = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${otherUser.accessToken}` },
    data: {
      name: 'Other User Tour',
      description: 'Recoleta, Buenos Aires',
      totalDays: 1,
    },
  });
  expect(otherResp.ok()).toBeTruthy();

  const me = await apiLogin(request);
  await seedAuthSession(page, me);
  await page.goto('/');
  await page.getByTestId('tab-saved').click();

  // The other user's tour must never leak into this session's list.
  await expect(page.getByText('Aún no tenés recorridos guardados')).toBeVisible({
    timeout: 10_000,
  });
});
