import { CatalogIdentityValidator } from './catalog-identity-validator.service';
import { CatalogAcquisitionOperation } from '@integrations/google-places/interfaces/places-api.interface';

describe('CatalogIdentityValidator', () => {
  let service: CatalogIdentityValidator;

  beforeEach(() => {
    service = new CatalogIdentityValidator();
  });

  const textOperation = (
    overrides: Partial<CatalogAcquisitionOperation> = {},
  ): CatalogAcquisitionOperation => ({
    operationId: 'seed:visitor-landmarks',
    purpose: 'destination_seed',
    providerOperation: 'text',
    category: 'visitor_landmarks',
    textQuery: 'top tourist attractions in Test City',
    geographicConstraint: {
      kind: 'circle',
      circle: { center: { latitude: 0, longitude: 0 }, radius: 5000 },
    },
    resultBudget: 10,
    preferredTime: 'day',
    supported: true,
    ...overrides,
  });

  const candidate = (overrides: Record<string, unknown> = {}) => ({
    provider: 'google' as const,
    externalId: 'place-1',
    name: 'Casa Histórica - Museo Nacional de la Independencia',
    latitude: -26.83,
    longitude: -65.2,
    providerTypes: ['history_museum', 'tourist_attraction', 'museum'],
    providerPrimaryType: 'history_museum',
    ...overrides,
  });

  it('accepts a candidate whose primary type matches its own operation category (baseline)', () => {
    const result = service.validate(
      candidate({ providerPrimaryType: 'tourist_attraction' }),
      { acquisitionOperation: textOperation() },
    );

    expect(result.rejectionReasons).not.toContain('unsupported_primary_type');
  });

  it('rejects a history_museum returned by a visitor_landmarks operation when no requestedInterests are given (prior behavior preserved)', () => {
    const result = service.validate(candidate(), {
      acquisitionOperation: textOperation({ category: 'visitor_landmarks' }),
    });

    expect(result.rejectionReasons).toContain('unsupported_primary_type');
  });

  it('accepts a history_museum returned by a visitor_landmarks operation when requestedInterests cover museums_and_arts too (the fix)', () => {
    // Reproduces the real Casa Histórica case: Google returns it under the
    // broad "top tourist attractions" (visitor_landmarks) Text Search after
    // exact-placeId dedup keeps that copy, but its real type (history_museum)
    // only appears in museums_and_arts — 'history' as a requested interest
    // covers both, so it must not be penalized for which operation won the
    // dedup race.
    const result = service.validate(candidate(), {
      acquisitionOperation: textOperation({ category: 'visitor_landmarks' }),
      requestedInterests: ['history'],
    });

    expect(result.rejectionReasons).not.toContain('unsupported_primary_type');
  });

  it('still rejects a candidate whose type matches none of the requested interests’ categories', () => {
    const result = service.validate(
      candidate({
        providerPrimaryType: 'restaurant',
        providerTypes: ['restaurant', 'food'],
      }),
      {
        acquisitionOperation: textOperation({ category: 'visitor_landmarks' }),
        requestedInterests: ['history'],
      },
    );

    expect(result.rejectionReasons).toContain('unsupported_primary_type');
  });

  it('leaves nearby operations unaffected by requestedInterests (they already carry explicit requestedPrimaryTypes)', () => {
    const result = service.validate(candidate(), {
      acquisitionOperation: textOperation({
        providerOperation: 'nearby',
        category: 'visitor_landmarks',
        requestedPrimaryTypes: ['tourist_attraction'],
      }),
      requestedInterests: ['history'],
    });

    expect(result.rejectionReasons).toContain('unsupported_primary_type');
  });
});
