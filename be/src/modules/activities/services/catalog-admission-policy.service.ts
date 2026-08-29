import {
  CatalogAdmissionEvidence,
  CatalogCandidate,
  CatalogCandidateRejectionReason,
  CatalogCandidateValidationContext,
} from '../interfaces/catalog-candidate-validation.interface';
import {
  CATALOG_ACQUISITION_TYPE_GROUPS,
  CatalogAcquisitionCategory,
} from '@integrations/google-places/utils/catalog-place-taxonomy';

interface ReviewConfidencePolicy {
  minimumRating: number;
  minimumReviewCount: number;
}

export const REVIEW_CONFIDENCE_BY_CATEGORY: Record<
  CatalogAcquisitionCategory,
  ReviewConfidencePolicy
> = {
  visitor_landmarks: { minimumRating: 4.0, minimumReviewCount: 50 },
  museums_and_arts: { minimumRating: 4.0, minimumReviewCount: 20 },
  outdoor: { minimumRating: 4.1, minimumReviewCount: 50 },
  food: { minimumRating: 4.2, minimumReviewCount: 100 },
  nightlife: { minimumRating: 4.2, minimumReviewCount: 100 },
  entertainment: { minimumRating: 4.0, minimumReviewCount: 100 },
};

const INSTITUTIONAL_PRIMARY_TYPES = new Set([
  'museum',
  'history_museum',
  'art_museum',
  'art_gallery',
  'historical_landmark',
  'historical_place',
  'cultural_landmark',
  'church',
  'place_of_worship',
  'national_park',
  'nature_preserve',
]);

export interface CatalogAdmissionResult {
  accepted: boolean;
  evidence?: CatalogAdmissionEvidence;
  rejectionReasons: CatalogCandidateRejectionReason[];
}

export class CatalogAdmissionPolicy {
  evaluate(
    candidate: CatalogCandidate,
    context: CatalogCandidateValidationContext = {},
  ): CatalogAdmissionResult {
    const category = this.resolveCategory(candidate, context);
    if (candidate.provider === 'geoapify') {
      const hasProviderEvidence =
        !!category &&
        !!candidate.formattedAddress?.trim() &&
        (candidate.providerTypes?.length ?? 0) > 0;
      return hasProviderEvidence
        ? {
            accepted: true,
            evidence: 'provider_specific',
            rejectionReasons: [],
          }
        : {
            accepted: false,
            rejectionReasons: ['insufficient_provider_evidence'],
          };
    }

    const policy = category
      ? REVIEW_CONFIDENCE_BY_CATEGORY[category]
      : undefined;
    const reviewConfidence =
      !!policy &&
      Number.isFinite(candidate.rating) &&
      Number.isFinite(candidate.ratingCount) &&
      (candidate.rating as number) >= policy.minimumRating &&
      (candidate.ratingCount as number) >= policy.minimumReviewCount;
    if (reviewConfidence) {
      return {
        accepted: true,
        evidence: 'review_confidence',
        rejectionReasons: [],
      };
    }

    const primaryType =
      candidate.providerPrimaryType ?? candidate.providerTypes?.[0];
    const isInstitution =
      !!primaryType && INSTITUTIONAL_PRIMARY_TYPES.has(primaryType);
    const hasCorroboration =
      !!candidate.website?.trim() ||
      !!candidate.phoneNumber?.trim() ||
      this.hasOpeningHours(candidate.openingHours);
    if (isInstitution && hasCorroboration) {
      return {
        accepted: true,
        evidence: 'institutional_corroboration',
        rejectionReasons: [],
      };
    }

    return {
      accepted: false,
      rejectionReasons: [
        'insufficient_review_confidence',
        ...(isInstitution && !hasCorroboration
          ? (['missing_institutional_corroboration'] as const)
          : []),
      ],
    };
  }

  private resolveCategory(
    candidate: CatalogCandidate,
    context: CatalogCandidateValidationContext,
  ): CatalogAcquisitionCategory | undefined {
    const operationCategory = context.acquisitionOperation?.category;
    if (
      operationCategory &&
      operationCategory in CATALOG_ACQUISITION_TYPE_GROUPS
    ) {
      return operationCategory as CatalogAcquisitionCategory;
    }
    const evidenceTypes = [
      ...(candidate.providerPrimaryType ? [candidate.providerPrimaryType] : []),
      ...(candidate.providerTypes ?? []),
    ];
    return (
      Object.entries(CATALOG_ACQUISITION_TYPE_GROUPS) as Array<
        [CatalogAcquisitionCategory, { primaryTypes: readonly string[] }]
      >
    ).find(([, group]) =>
      evidenceTypes.some((type) => group.primaryTypes.includes(type)),
    )?.[0];
  }

  private hasOpeningHours(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const weekdayText = (value as { weekdayText?: unknown }).weekdayText;
    return Array.isArray(weekdayText) && weekdayText.length > 0;
  }
}
