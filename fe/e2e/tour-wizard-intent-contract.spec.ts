import { expect, test } from '@playwright/test';
import { loginViaUI } from './auth-helper';

test('serializes destination, mobility and experience intent independently', async ({
  page
}) => {
  let submittedPayload: any;

  // The home/map context refreshes nearby tours when the destination moves.
  // Keep this contract test isolated from TourLocationService's separate
  // legacy auto-generation path so it never consumes Groq or Places quota.
  await page.route('**/tours/nearby?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]'
    });
  });
  await page.route('**/api.geoapify.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        features: [
          {
            properties: {
              place_id: 'test-city',
              formatted: 'Córdoba, Argentina',
              lat: -31.4201,
              lon: -64.1888,
              result_type: 'city',
            },
            bbox: [-64.28, -31.5, -64.1, -31.34],
          },
        ],
      }),
    });
  });
  await page.route('**/gplaces/v1/places:autocomplete', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: 'test-city',
              text: { text: 'Córdoba, Argentina' }
            }
          }
        ]
      })
    });
  });
  await page.route('**/gplaces/v1/places/test-city?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-city',
        formattedAddress: 'Córdoba, Argentina',
        location: { latitude: -31.4201, longitude: -64.1888 },
        viewport: {
          low: { latitude: -31.5, longitude: -64.28 },
          high: { latitude: -31.34, longitude: -64.1 }
        },
        types: ['locality', 'political'],
        primaryType: 'locality'
      })
    });
  });
  await page.route('**/tours/generate-tour', async (route) => {
    submittedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-4000-8000-000000000004',
        name: 'Córdoba, Argentina',
        metadata: { generationStatus: 'pending' },
        activities: []
      })
    });
  });

  await loginViaUI(page);
  await page.getByTestId('create-tour-fab').click();

  await page.getByPlaceholder(/Ej: Roma|Buscar destino/i).fill('Córdoba');
  await page.getByText('Córdoba, Argentina', { exact: true }).click();
  await page.getByTestId('wizard-cta-button').click();

  await page.getByText('$$', { exact: true }).click();
  await page.getByText('Familia', { exact: true }).click();
  await page.getByText('Bus/Subte', { exact: true }).click();
  await page.getByText('A Pie', { exact: true }).click();
  await page.getByText('Me gusta caminar', { exact: true }).click();
  await page.getByText(/Silla de ruedas/i).click();
  await page.getByTestId('wizard-cta-button').click();

  await page.getByText(/Visitas a Lugares/i).click();
  await page.getByText('Icónicos', { exact: true }).click();
  await page.getByText('Historia', { exact: true }).last().click();
  await page
    .getByPlaceholder(/fotografía urbana/i)
    .fill('  Evitar multitudes y priorizar fotografía urbana.  ');

  await page.getByTestId('wizard-cta-button').click();
  await expect.poll(() => submittedPayload).toBeTruthy();

  expect(submittedPayload).toMatchObject({
    destination: {
      label: 'Córdoba, Argentina',
      latitude: -31.4201,
      longitude: -64.1888,
      scaleHint: 'settlement'
    },
    days: 3,
    budgetLevel: 'medium',
    groupType: 'family',
    intent: {
      interests: ['history'],
      experienceFormats: ['neighborhood_walks'],
      explorationStyle: 'iconic',
      additionalPreferences: 'Evitar multitudes y priorizar fotografía urbana.'
    },
    mobility: {
      allowedTransportationModes: ['public_transport'],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: 'moderate',
      accessibilityNeeds: ['wheelchair_access']
    }
  });

  expect(submittedPayload).not.toHaveProperty('prompt');
  expect(submittedPayload).not.toHaveProperty('destinationLatitude');
  expect(submittedPayload).not.toHaveProperty('transportationMode');
});
