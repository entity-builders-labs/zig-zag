import { buildCatalogAcquisitionPlan } from './catalog-acquisition-plan.util';

const anchors = [
  {
    id: 'destination-point',
    latitude: -31.42,
    longitude: -64.18,
    radiusMeters: 2500,
  },
  {
    id: 'west',
    latitude: -31.42,
    longitude: -64.24,
    radiusMeters: 2000,
  },
];

describe('buildCatalogAcquisitionPlan', () => {
  it('builds explicit Google Text seeds before Nearby primary-type coverage', () => {
    const plan = buildCatalogAcquisitionPlan({
      provider: 'google',
      anchors,
      requestedInterests: ['history'],
      destinationLabel: 'Córdoba, Argentina',
      destinationBoundary: {
        type: 'Polygon',
        coordinates: [
          [
            [-64.3, -31.5],
            [-64.0, -31.5],
            [-64.0, -31.3],
            [-64.3, -31.5],
          ],
        ],
      },
      maxProviderCalls: 6,
      resultBudget: 10,
    });

    expect(plan.slice(0, 2)).toEqual([
      expect.objectContaining({
        operationId: 'seed:tourist-attractions',
        purpose: 'destination_seed',
        providerOperation: 'text',
        includedType: 'tourist_attraction',
        strictTypeFiltering: false,
        geographicConstraint: {
          kind: 'rectangle',
          rectangle: {
            low: { latitude: -31.5, longitude: -64.3 },
            high: { latitude: -31.3, longitude: -64 },
          },
        },
        supported: true,
      }),
      expect.objectContaining({
        operationId: 'seed:culture-history',
        providerOperation: 'text',
        includedType: 'museum',
        supported: true,
      }),
    ]);
    expect(plan.slice(2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purpose: 'geographic_coverage',
          providerOperation: 'nearby',
          requestedPrimaryTypes: expect.arrayContaining([
            'tourist_attraction',
            'historical_landmark',
          ]),
          rankPreference: 'POPULARITY',
        }),
      ]),
    );
    expect(plan.filter(({ supported }) => supported)).toHaveLength(6);
  });

  it('records Google-only seeds as unsupported for Geoapify without consuming its call budget', () => {
    const plan = buildCatalogAcquisitionPlan({
      provider: 'geoapify',
      anchors,
      requestedInterests: ['outdoor'],
      destinationLabel: 'Córdoba, Argentina',
      maxProviderCalls: 2,
      resultBudget: 10,
    });

    expect(
      plan.filter(({ providerOperation }) => providerOperation === 'text'),
    ).toEqual([
      expect.objectContaining({
        supported: false,
        unsupportedReason: 'provider_capability',
      }),
      expect.objectContaining({
        supported: false,
        unsupportedReason: 'provider_capability',
      }),
    ]);
    expect(
      plan.filter(
        ({ supported, providerOperation }) =>
          supported && providerOperation === 'nearby',
      ),
    ).toHaveLength(2);
  });

  it('shares a bounded mixed-interest budget across categories and anchors', () => {
    const plan = buildCatalogAcquisitionPlan({
      provider: 'google',
      anchors,
      requestedInterests: ['history', 'food'],
      maxProviderCalls: 4,
      resultBudget: 5,
    });

    expect(plan.map(({ operationId }) => operationId)).toEqual([
      'coverage:destination-point:visitor_landmarks',
      'coverage:west:museums_and_arts',
      'coverage:destination-point:museums_and_arts',
      'coverage:west:food',
    ]);
  });
});
