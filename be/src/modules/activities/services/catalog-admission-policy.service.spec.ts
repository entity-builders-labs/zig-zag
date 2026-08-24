import { CatalogAdmissionPolicy } from './catalog-admission-policy.service';
import { CatalogCandidateValidationContext } from '../interfaces/catalog-candidate-validation.interface';

describe('CatalogAdmissionPolicy', () => {
  const policy = new CatalogAdmissionPolicy();
  const visitorContext: CatalogCandidateValidationContext = {
    acquisitionOperation: {
      operationId: 'coverage:center:visitor_landmarks',
      purpose: 'geographic_coverage',
      providerOperation: 'nearby',
      category: 'visitor_landmarks',
      requestedPrimaryTypes: ['tourist_attraction'],
      rankPreference: 'POPULARITY',
      geographicConstraint: {
        kind: 'circle',
        circle: {
          center: { latitude: -32.95, longitude: -60.66 },
          radius: 2_000,
        },
      },
      resultBudget: 10,
      anchorId: 'center',
      preferredTime: 'day',
      supported: true,
    },
  };
  const visitor = {
    provider: 'google' as const,
    externalId: 'place-1',
    name: 'Visitor landmark',
    latitude: -32.95,
    longitude: -60.66,
    providerTypes: ['tourist_attraction'],
    providerPrimaryType: 'tourist_attraction',
    formattedAddress: 'Rosario, Argentina',
  };

  it.each([
    { rating: 5, ratingCount: 1 },
    { rating: 4.9, ratingCount: 49 },
    { rating: 3.9, ratingCount: 10_000 },
  ])(
    'rejects weak review evidence at the visitor-landmark boundaries: %p',
    (reviewEvidence) => {
      const result = policy.evaluate(
        { ...visitor, ...reviewEvidence },
        visitorContext,
      );

      expect(result.accepted).toBe(false);
      expect(result.rejectionReasons).toContain(
        'insufficient_review_confidence',
      );
    },
  );

  it('admits review evidence exactly at the configured visitor-landmark boundary', () => {
    expect(
      policy.evaluate(
        { ...visitor, rating: 4.0, ratingCount: 50 },
        visitorContext,
      ),
    ).toEqual({
      accepted: true,
      evidence: 'review_confidence',
      rejectionReasons: [],
    });
  });

  it('admits a review-sparse institution only with structured corroboration', () => {
    const result = policy.evaluate({
      ...visitor,
      providerTypes: ['museum'],
      providerPrimaryType: 'museum',
      rating: undefined,
      ratingCount: undefined,
      openingHours: { weekdayText: ['Monday: 9:00 AM – 6:00 PM'] },
    });

    expect(result).toEqual({
      accepted: true,
      evidence: 'institutional_corroboration',
      rejectionReasons: [],
    });
  });
});
