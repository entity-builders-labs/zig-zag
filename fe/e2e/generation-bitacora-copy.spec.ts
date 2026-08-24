import { expect, test } from '@playwright/test';
import { API_URL } from './playwright.config';
import { apiLogin, seedAuthSession } from './auth-helper';

test('clicking the generation bitacora copies its complete text', async ({ context, page, request }) => {
  const session = await apiLogin(request);
  const createResponse = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      name: 'Bitacora clipboard fixture',
      totalDays: 1,
      metadata: {
        generationTrace: {
          steps: [
            {
              stage: 'destination_resolution',
              label: 'Resolución del destino',
              summary: '"San Juan" resolvió a un límite real de ciudad.',
            },
            {
              stage: 'places_crawl',
              label: 'Catalog refill · Google Places',
              summary: 'Google Places recibió 1 resultado y persistió 1.',
              candidates: [
                {
                  source: 'google_places',
                  id: 'activity-1',
                  name: 'Museo Histórico Provincial',
                  detail: 'rating 4.7/5 (240 reviews)',
                  offered: true,
                  chosen: true,
                },
              ],
            },
          ],
          hallucinatedCount: 0,
          duplicateCount: 0,
          auditFindings: {
            perActivity: [
              {
                activityId: 'activity-1',
                activityName: 'Museo Histórico Provincial',
                openingHoursCheck: 'no_data',
                priceLevelCheck: 'ok',
              },
            ],
          },
        },
      },
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: tourId } = await createResponse.json();

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('bitacora-toggle').click();

  await expect(page.getByText('✓ Bitácora copiada')).toBeVisible();
  const copiedText = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedText).toContain('🐛 Bitácora de generación (dev)');
  expect(copiedText).toContain('Resolución del destino');
  expect(copiedText).toContain('Museo Histórico Provincial');
  expect(copiedText).toContain('(rating 4.7/5 (240 reviews))');
  expect(copiedText).toContain('Ofrecido\nElegido\nsin datos · OK');
});
