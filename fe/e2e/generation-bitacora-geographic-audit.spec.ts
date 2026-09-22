import { expect, test } from '@playwright/test';
import { API_URL } from './playwright.config';
import { apiLogin, seedAuthSession } from './auth-helper';

async function createTourWithTrace(
  request: import('@playwright/test').APIRequestContext,
  accessToken: string,
  name: string,
  steps: unknown[]
) {
  const createResponse = await request.post(`${API_URL}/tours`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      name,
      totalDays: 1,
      metadata: {
        generationTrace: {
          steps,
          hallucinatedCount: 0,
          duplicateCount: 0,
        },
      },
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { id: tourId } = await createResponse.json();
  return tourId as string;
}

const NOISE_STRINGS = ['NaN', 'Infinity', 'undefined', 'null'];

async function expectNoNoiseStrings(page: import('@playwright/test').Page) {
  for (const noise of NOISE_STRINGS) {
    await expect(page.getByText(noise, { exact: true })).toHaveCount(0);
  }
}

test('rejected destination-boundary mismatch surfaces the offending component and distance', async ({
  page,
  request,
}) => {
  const session = await apiLogin(request);
  const tourId = await createTourWithTrace(request, session.accessToken, 'Bitacora geo audit — rejected', [
    {
      stage: 'geographic_validation',
      label: 'Validación geográfica',
      summary: 'Validación geográfica de candidatos frente al destino.',
      geographicValidationAudit: [
        {
          candidateTraceKey: 'candidate-1',
          candidateName: 'Parque Lezama Walk',
          accepted: false,
          status: 'REJECTED',
          strategy: 'boundary_check',
          validationIntent: 'walk',
          destinationBoundary: { name: 'San Telmo', externalId: 'osm:relation:2223069' },
          rejectionReasons: ['OUTSIDE_DESTINATION_BOUNDARY'],
          components: [
            {
              hintName: 'Plaza Dorrego',
              hintKey: 'h1',
              role: 'venue',
              relation: 'evaluated',
            },
            {
              hintName: 'Parque Lezama',
              hintKey: 'h2',
              role: 'venue',
              relation: 'offending',
              decisionReason: 'OUTSIDE_DESTINATION_BOUNDARY',
              distanceToBoundaryMeters: 83.4,
            },
          ],
        },
      ],
    },
  ]);

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('bitacora-toggle').first().click();

  await expect(page.getByText('Auditoría geográfica').first()).toBeVisible();
  await expect(page.getByText('Parque Lezama Walk').first()).toBeVisible();
  await expect(page.getByText('OUTSIDE_DESTINATION_BOUNDARY').first()).toBeVisible();
  await expect(page.getByText('Fuera del límite del destino').first()).toBeVisible();
  await expect(page.getByText('83 m').first()).toBeVisible();
  await expect(page.getByText('San Telmo').first()).toBeVisible();
  await expect(page.getByText('walk').first()).toBeVisible();
});

test('multiple offending components are all rendered, not collapsed to one', async ({ page, request }) => {
  const session = await apiLogin(request);
  const tourId = await createTourWithTrace(request, session.accessToken, 'Bitacora geo audit — multi offender', [
    {
      stage: 'geographic_validation',
      label: 'Validación geográfica',
      summary: 'Validación geográfica de candidatos frente al destino.',
      geographicValidationAudit: [
        {
          candidateTraceKey: 'candidate-2',
          candidateName: 'Costanera Route',
          accepted: false,
          status: 'REJECTED',
          strategy: 'route_corridor_check',
          rejectionReasons: ['REGION_CONFLICT', 'OUTSIDE_ROUTE_DESTINATION_RADIUS'],
          components: [
            {
              hintName: 'Reserva Ecológica',
              relation: 'offending',
              decisionReason: 'REGION_CONFLICT',
              distanceToBoundaryMeters: 1200,
            },
            {
              hintName: 'Puerto Madero Dique 4',
              relation: 'offending',
              decisionReason: 'OUTSIDE_ROUTE_DESTINATION_RADIUS',
            },
          ],
        },
      ],
    },
  ]);

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('bitacora-toggle').first().click();

  await expect(page.getByText('Reserva Ecológica').first()).toBeVisible();
  await expect(page.getByText('Puerto Madero Dique 4').first()).toBeVisible();
});

test('rejection without a distance renders the reason but no placeholder noise text', async ({
  page,
  request,
}) => {
  const session = await apiLogin(request);
  const tourId = await createTourWithTrace(request, session.accessToken, 'Bitacora geo audit — no distance', [
    {
      stage: 'geographic_validation',
      label: 'Validación geográfica',
      summary: 'Validación geográfica de candidatos frente al destino.',
      geographicValidationAudit: [
        {
          candidateTraceKey: 'candidate-3',
          candidateName: 'Ruta del Vino Externa',
          accepted: false,
          status: 'REJECTED',
          strategy: 'route_corridor_check',
          scope: { kind: 'ROUTE', anchorName: 'Ruta del Vino', geoEntityId: 'geo-route-1' },
          rejectionReasons: ['EXTERNAL_ROUTE_SCOPE_MISMATCH'],
          components: [
            {
              hintName: 'Bodega Fuera de Corredor',
              relation: 'offending',
              decisionReason: 'EXTERNAL_ROUTE_SCOPE_MISMATCH',
            },
          ],
        },
      ],
    },
  ]);

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('bitacora-toggle').first().click();

  await expect(page.getByText('EXTERNAL_ROUTE_SCOPE_MISMATCH').first()).toBeVisible();
  await expect(page.getByText('Fuera del corredor de la ruta').first()).toBeVisible();
  await expectNoNoiseStrings(page);
});

test('accepted candidate renders without fabricated rejection details', async ({ page, request }) => {
  const session = await apiLogin(request);
  const tourId = await createTourWithTrace(request, session.accessToken, 'Bitacora geo audit — accepted', [
    {
      stage: 'geographic_validation',
      label: 'Validación geográfica',
      summary: 'Validación geográfica de candidatos frente al destino.',
      geographicValidationAudit: [
        {
          candidateTraceKey: 'candidate-4',
          candidateName: 'Puerto Madero Route',
          accepted: true,
          status: 'ACCEPTED',
          strategy: 'boundary_check',
          validationIntent: 'route_like',
          destinationBoundary: { name: 'Puerto Madero', externalId: 'osm:relation:999' },
          rejectionReasons: [],
          components: [
            { hintName: 'Puente de la Mujer', relation: 'accepted' },
            { hintName: 'Dique 3', relation: 'evaluated' },
          ],
        },
      ],
    },
  ]);

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('bitacora-toggle').first().click();

  await expect(page.getByText('Puerto Madero Route').first()).toBeVisible();
  await expect(page.getByText('Puente de la Mujer').first()).toBeVisible();
  await expect(page.getByText('Dique 3').first()).toBeVisible();
  await expect(page.getByText('OUTSIDE_DESTINATION_BOUNDARY')).toHaveCount(0);
  await expectNoNoiseStrings(page);
});

test('non-geographic stage does not render the geographic audit panel', async ({ page, request }) => {
  const session = await apiLogin(request);
  const tourId = await createTourWithTrace(request, session.accessToken, 'Bitacora geo audit — generic stage', [
    {
      stage: 'destination_resolution',
      label: 'Resolución del destino',
      summary: '"San Telmo" resolvió a un límite real de barrio.',
    },
  ]);

  await seedAuthSession(page, session);
  await page.goto(`/tours/${tourId}`);
  await page.getByTestId('bitacora-toggle').first().click();

  await expect(
    page.getByText('"San Telmo" resolvió a un límite real de barrio.').first()
  ).toBeVisible();
  await expect(page.getByText('Auditoría geográfica')).toHaveCount(0);
});
