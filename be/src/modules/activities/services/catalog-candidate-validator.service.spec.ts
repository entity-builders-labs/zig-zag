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
  const nearbyMuseumsOperation = {
    operationId: 'coverage:center:museums_and_arts',
    purpose: 'geographic_coverage' as const,
    providerOperation: 'nearby' as const,
    category: 'museums_and_arts',
    requestedPrimaryTypes: [
      'museum',
      'history_museum',
      'art_museum',
      'art_gallery',
    ],
    rankPreference: 'POPULARITY' as const,
    geographicConstraint: {
      kind: 'circle' as const,
      circle: {
        center: { latitude: 2, longitude: 2 },
        radius: 2_000,
      },
    },
    resultBudget: 10,
    anchorId: 'center',
    preferredTime: 'day',
    supported: true,
  };

  it('accepts a supported, identified POI inside the destination boundary', () => {
    expect(
      service.validate(validCandidate, { destinationBoundary: boundary }),
    ).toEqual({
      accepted: true,
      identityAccepted: true,
      admissionAccepted: true,
      admissionEvidence: 'review_confidence',
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

  it('rejects a Google institution without reviews or structured corroboration', () => {
    const result = service.validate({
      ...validCandidate,
      rating: undefined,
      ratingCount: undefined,
      providerTypes: ['museum'],
    });

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toEqual(
      expect.arrayContaining([
        'insufficient_review_confidence',
        'missing_institutional_corroboration',
      ]),
    );
  });

  it('admits a supported Google institution corroborated by provider data', () => {
    const result = service.validate({
      ...validCandidate,
      rating: undefined,
      ratingCount: undefined,
      providerTypes: ['museum'],
      providerPrimaryType: 'museum',
      website: 'https://museum.example',
    });

    expect(result.accepted).toBe(true);
    expect(result.admissionEvidence).toBe('institutional_corroboration');
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
    expect(result.rejectionReasons).toContain('insufficient_provider_evidence');
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

  it('rejects a supported global type when it does not match the acquisition operation', () => {
    const result = service.validate(
      {
        ...validCandidate,
        name: 'Camping Sindicato de Televisión',
        providerTypes: ['campground', 'lodging', 'point_of_interest'],
        providerPrimaryType: 'campground',
      },
      { acquisitionOperation: nearbyMuseumsOperation },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('unsupported_primary_type');
  });

  it('admits a tourism-specific primary type returned by flexible Text Search', () => {
    const result = service.validate(
      {
        ...validCandidate,
        name: 'Monumento Nacional a la Bandera',
        providerTypes: ['sculpture', 'historical_place', 'point_of_interest'],
        providerPrimaryType: 'sculpture',
      },
      {
        acquisitionOperation: {
          operationId: 'seed:tourist-attractions',
          purpose: 'destination_seed',
          providerOperation: 'text',
          category: 'visitor_landmarks',
          textQuery: 'top tourist attractions in Rosario',
          includedType: 'tourist_attraction',
          strictTypeFiltering: false,
          geographicConstraint: nearbyMuseumsOperation.geographicConstraint,
          resultBudget: 10,
          preferredTime: 'day',
          supported: true,
        },
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.rejectionReasons).not.toContain('unsupported_primary_type');
  });

  it('rejects a school misclassified with a church primary type without relying on its name', () => {
    const result = service.validate(
      {
        ...validCandidate,
        name: 'Any provider-supplied institution name',
        providerPrimaryType: 'church',
        providerTypes: [
          'church',
          'place_of_worship',
          'school',
          'educational_institution',
          'point_of_interest',
        ],
        rating: 4.8,
        ratingCount: 500,
      },
      {
        acquisitionOperation: {
          ...nearbyMuseumsOperation,
          operationId: 'coverage:center:visitor_landmarks',
          category: 'visitor_landmarks',
          requestedPrimaryTypes: ['church'],
        },
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain('conflicting_provider_types');
  });

  it('rejects campground/lodging identity masked by a generic park primary type', () => {
    const result = service.validate(
      {
        ...validCandidate,
        name: 'Any provider-supplied outdoor venue name',
        providerPrimaryType: 'park',
        providerTypes: [
          'park',
          'campground',
          'lodging',
          'point_of_interest',
          'establishment',
        ],
        rating: 4.8,
        ratingCount: 600,
      },
      {
        acquisitionOperation: {
          ...nearbyMuseumsOperation,
          operationId: 'coverage:center:outdoor',
          category: 'outdoor',
          requestedPrimaryTypes: ['park'],
        },
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.identityAccepted).toBe(false);
    expect(result.rejectionReasons).toContain('conflicting_provider_types');
  });
});
