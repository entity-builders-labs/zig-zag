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
              summary:
                'Google Places recibió 2 resultados y persistió 1. Rechazos totales registrados: 1. Motivos registrados (un candidato puede tener más de uno): generic_name=1.',
              candidates: [
                {
                  source: 'google_places',
                  id: 'activity-1',
                  name: 'Museo Histórico Provincial',
                  detail:
                    'tipo proveedor museum · categoría cultural · rating 4.7/5 (240 reviews)',
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
  await page.getByTestId('bitacora-toggle').first().click();

  await expect(page.getByText('Bitácora de Generación').first()).toBeVisible();
  await expect(page.getByText('Resolución del destino').first()).toBeVisible();
  await page.getByText('Catalog refill · Google Places').first().click();
  await expect(page.getByText('Museo Histórico Provincial').first()).toBeVisible();
});

test('collapsible execution summary toggles open and closed', async ({ context, page, request }) => {
  const session = await apiLogin(request);
  const createResponse = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      name: 'Bitacora summary collapse fixture',
      totalDays: 1,
      metadata: {
        generationTrace: {
          steps: [
            {
              stage: 'destination_resolution',
              label: 'Resolución del destino',
              summary: '"Mendoza" resolvió a un límite real de ciudad.',
            },
          ],
          hallucinatedCount: 0,
          duplicateCount: 0,
          executionSummary: {
            status: 'completed',
            steps: ['Destino resuelto a Mendoza.'],
            narrative: '1. Destino resuelto a Mendoza.',
            acceptedExperiences: 4,
            selectedExperiences: 3,
            rejectedProposals: 1,
          },
        },
      },
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: tourId } = await createResponse.json();

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('bitacora-toggle').first().click();

  await expect(page.getByText('Bitácora de Generación').first()).toBeVisible();
  await expect(page.getByTestId('bitacora-summary-toggle')).toBeVisible();
  await expect(page.getByText('3 seleccionadas')).toBeVisible();
  await expect(page.getByText('4 validadas')).toBeVisible();

  // Initially collapsed: 'Ver detalle' is visible
  await expect(page.getByText('Ver detalle')).toBeVisible();

  // Click to expand
  await page.getByTestId('bitacora-summary-toggle').click();
  await expect(page.getByText('Ocultar')).toBeVisible();
  await expect(page.getByText('Validación Geográfica')).toBeVisible();

  // Click to collapse
  await page.getByTestId('bitacora-summary-toggle').click();
  await expect(page.getByText('Ver detalle')).toBeVisible();
});

