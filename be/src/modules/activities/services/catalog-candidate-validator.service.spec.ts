import {
  CatalogCandidate,
  CatalogCandidateRejectionReason,
  CatalogCandidateValidatorService,
} from './catalog-candidate-validator.service';

describe('CatalogCandidateValidatorService', () => {
  const service = new CatalogCandidateValidatorService();
  const validCandidate = {
    provider: 'google' as const,
    externalId: 'place-1',
    name: 'Museo de la Ciudad',
    latitude: 2,
    longitude: 2,
    providerTypes: ['museum'],
    formattedAddress: 'Calle 1, Ciudad',
    businessStatus: 'OPERATIONAL',
    rating: 4.7,
    ratingCount: 120,
  };
  const boundary = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [0, 0] as [number, number],
        [4, 0] as [number, number],
        [4, 4] as [number, number],
        [0, 4] as [number, number],
        [0, 0] as [number, number],
      ],
    ],
  };

  it('accepts a supported, identified POI inside the destination boundary', () => {
    expect(
      service.validate(validCandidate, { destinationBoundary: boundary }),
    ).toEqual({
      accepted: true,
      normalizedName: 'museo de la ciudad',
      rejectionReasons: [],
    });
  });

  it('rejects an empty name before it can be persisted', () => {
    const result = service.validate({ ...validCandidate, name: '   ' });

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('empty_name');
  });

  const invalidCases: Array<
    [CatalogCandidateRejectionReason, Partial<CatalogCandidate>]
  > = [
    ['missing_provider_id', { externalId: '   ' }],
    ['invalid_coordinates', { latitude: Number.NaN }],
    ['unsupported_type', { providerTypes: ['accounting'] }],
  ];

  it.each(invalidCases)(
    'reports %s with its exact rejection reason',
    (reason, candidatePatch) => {
      const result = service.validate({ ...validCandidate, ...candidatePatch });

      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain(reason);
    },
  );

  it('rejects a high-rated result outside the authoritative city boundary', () => {
    const result = service.validate(
      { ...validCandidate, latitude: 20, longitude: 20, rating: 5 },
      { destinationBoundary: boundary },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('outside_destination_boundary');
  });

  it('rejects generic mapping labels such as Arquitectura', () => {
    const result = service.validate({
      ...validCandidate,
      provider: 'geoapify',
      name: 'Arquitectura',
      providerTypes: ['tourist_attraction'],
    });

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('generic_name');
  });

  it('rejects permanently closed and address-only results', () => {
    const result = service.validate({
      ...validCandidate,
      businessStatus: 'CLOSED_PERMANENTLY',
      providerTypes: ['street_address'],
    });

    expect(result.rejectionReasons).toEqual(
      expect.arrayContaining(['permanently_closed', 'address_only']),
    );
  });

  it('does not interpret a temporary closure as a permanent closure', () => {
    const result = service.validate({
      ...validCandidate,
      businessStatus: 'CLOSED_TEMPORARILY',
    });

    expect(result.accepted).toBe(true);
    expect(result.rejectionReasons).not.toContain('permanently_closed');
  });

  it('accepts a trusted Google institution without review evidence', () => {
    const result = service.validate({
      ...validCandidate,
      rating: undefined,
      ratingCount: undefined,
      providerTypes: ['museum'],
    });

    expect(result.accepted).toBe(true);
  });

  it('uses a provider-appropriate quality policy when Geoapify has no ratings', () => {
    const result = service.validate({
      ...validCandidate,
      provider: 'geoapify',
      rating: undefined,
      ratingCount: undefined,
      formattedAddress: '',
    });

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('insufficient_quality');
  });

  it('accepts Geoapify evidence made of a mapped type and formatted address', () => {
    const result = service.validate({
      ...validCandidate,
      provider: 'geoapify',
      rating: undefined,
      ratingCount: undefined,
    });

    expect(result.accepted).toBe(true);
  });
});
