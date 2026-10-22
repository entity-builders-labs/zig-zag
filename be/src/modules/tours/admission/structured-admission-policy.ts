/**
 * Single source of truth for the structured admission policy (design C6/C7,
 * task 37.1). Provider-neutral: it reasons over canonical admission signals
 * and exclusion classes, never provider tags or discovery selectors.
 *
 * Provider adapters (OSM tags, Wikidata facts) translate provider data into
 * the canonical facts defined here. Admission (task 36.1), sub-feature
 * grouping (task 35.1), ranking and planning consume this policy — no other
 * component, test or experiment may maintain its own exclusion list or
 * admission whitelist.
 */

/** Canonical admission signal types (design C6). */
export type AdmissionSignalType =
  | 'EXPLICIT_VISITOR_CLASSIFICATION'
  | 'HISTORIC_CLASSIFICATION'
  | 'HERITAGE_DESIGNATION'
  | 'VISITABLE_PLACE_CLASS'
  | 'ENCYCLOPEDIC_NOTABILITY'
  | 'PROVIDER_PROMINENCE';

export interface AdmissionSignalEvidence {
  signal: AdmissionSignalType;
  field: string;
  value: string | number;
}

/** Decisive signals admit on their own; supporting signals never do. */
export type AdmissionSignalStrength = 'decisive' | 'supporting';

export interface AdmissionSignal {
  type: AdmissionSignalType;
  strength: AdmissionSignalStrength;
}

export const ADMISSION_SIGNAL_STRENGTHS: Readonly<
  Record<AdmissionSignalType, AdmissionSignalStrength>
> = {
  EXPLICIT_VISITOR_CLASSIFICATION: 'decisive',
  HISTORIC_CLASSIFICATION: 'supporting',
  HERITAGE_DESIGNATION: 'decisive',
  VISITABLE_PLACE_CLASS: 'supporting',
  ENCYCLOPEDIC_NOTABILITY: 'supporting',
  PROVIDER_PROMINENCE: 'supporting',
};

export const DECISIVE_ADMISSION_SIGNALS: readonly AdmissionSignalType[] = [
  'EXPLICIT_VISITOR_CLASSIFICATION',
  'HERITAGE_DESIGNATION',
];

export const SUPPORTING_ADMISSION_SIGNALS: readonly AdmissionSignalType[] = [
  'HISTORIC_CLASSIFICATION',
  'VISITABLE_PLACE_CLASS',
  'ENCYCLOPEDIC_NOTABILITY',
  'PROVIDER_PROMINENCE',
];

/** Build a canonical signal with the strength the policy assigns its type. */
export function admissionSignal(type: AdmissionSignalType): AdmissionSignal {
  return { type, strength: ADMISSION_SIGNAL_STRENGTHS[type] };
}

/**
 * Generic exclusion classes (design C6). Non-overridable classes always
 * reject; overridable classes yield to a decisive signal.
 */
export type AdmissionExclusionClass =
  | 'ADMINISTRATIVE_OR_LOCALITY'
  | 'ROAD_OR_ROUTE'
  | 'INFORMATION_OR_SIGNAGE'
  | 'SUB_FEATURE'
  | 'TRANSPORT_SERVICE'
  | 'TECHNICAL_INFRASTRUCTURE'
  | 'ACCOMMODATION';

export const EXCLUSION_OVERRIDABILITY: Readonly<
  Record<AdmissionExclusionClass, boolean>
> = {
  ADMINISTRATIVE_OR_LOCALITY: false,
  ROAD_OR_ROUTE: false,
  INFORMATION_OR_SIGNAGE: false,
  SUB_FEATURE: false,
  TRANSPORT_SERVICE: true,
  TECHNICAL_INFRASTRUCTURE: true,
  ACCOMMODATION: true,
};

export function isExclusionOverridable(
  klass: AdmissionExclusionClass,
): boolean {
  return EXCLUSION_OVERRIDABILITY[klass];
}

/** Whether this decision-level exclusion is represented as an admission row. */
export function isAdmissionExclusionPersisted(
  klass: AdmissionExclusionClass,
): boolean {
  return klass !== 'SUB_FEATURE';
}

export function isRouteExclusion(klass: AdmissionExclusionClass): boolean {
  return klass === 'ROAD_OR_ROUTE';
}

/**
 * Parent/child visit-unit semantics (design C5, R4-D2). The policy declares
 * the generic (child class, parent class) relationship classes and their
 * default visit unit; per-instance structured evidence refines it.
 */
export type VisitUnit =
  | 'CHILD_REQUIRES_PARENT_VISIT'
  | 'CHILD_INDEPENDENTLY_VISITABLE';

export type ChildPlaceClass = 'grave' | 'artwork' | 'venue';
export type ParentPlaceClass = 'cemetery' | 'museum' | 'park_or_complex';

export type RelationshipClassKey = `${ChildPlaceClass}:${ParentPlaceClass}`;

export const DEFAULT_VISIT_UNITS: Readonly<
  Partial<Record<RelationshipClassKey, VisitUnit>>
> = {
  'grave:cemetery': 'CHILD_REQUIRES_PARENT_VISIT',
  'artwork:museum': 'CHILD_REQUIRES_PARENT_VISIT',
  'venue:park_or_complex': 'CHILD_INDEPENDENTLY_VISITABLE',
};

/**
 * Ranking-readable canonical place class. Produced by provider adapters from
 * provider categories; consumed by ranking. Not exhaustive (C6: the visitable
 * place mapping is supporting evidence, never a whitelist).
 */
export type CanonicalPlaceClass = string;

/** Versioned policy identity; bump when the rule or vocabulary changes. */
export const STRUCTURED_ADMISSION_POLICY_VERSION = 'structured-admission-v2';

export type AdmissionRejectionReason =
  | 'EXCLUDED_CATEGORY'
  | 'INSUFFICIENT_ADMISSION_EVIDENCE';

export type AdmissionDecision =
  | { admitted: true; signals: AdmissionSignalType[] }
  | { admitted: false; reason: AdmissionRejectionReason };

/**
 * The admission rule (design C6, steps 1-4). Applied after identity, name,
 * coordinates and destination containment have already passed (task 36.1
 * owns that gate wiring). Decisive and supporting are policy strengths, not
 * scores: there is no weighted sum and no tuned cutoff.
 */
export function evaluateAdmissionRule(
  signals: readonly AdmissionSignal[],
  exclusions: readonly AdmissionExclusionClass[],
): AdmissionDecision {
  const present = new Set(signals.map((signal) => signal.type));
  const exclusionSet = new Set(exclusions);

  // 1. A non-overridable exclusion always rejects.
  for (const exclusion of exclusionSet) {
    if (!isExclusionOverridable(exclusion)) {
      return { admitted: false, reason: 'EXCLUDED_CATEGORY' };
    }
  }

  // 2. A decisive signal admits — including over an overridable exclusion.
  const decisive = DECISIVE_ADMISSION_SIGNALS.filter((type) =>
    present.has(type),
  );
  if (decisive.length > 0) {
    return { admitted: true, signals: [...present].sort() };
  }

  // 3. Descriptive place classifications plus an independent notability
  //    signal admit, unless an overridable exclusion applies. Classification
  //    evidence alone (including HISTORIC_CLASSIFICATION) is never decisive.
  if (exclusionSet.size > 0) {
    return { admitted: false, reason: 'EXCLUDED_CATEGORY' };
  }
  const classified =
    present.has('VISITABLE_PLACE_CLASS') ||
    present.has('HISTORIC_CLASSIFICATION');
  const notable =
    present.has('ENCYCLOPEDIC_NOTABILITY') ||
    present.has('PROVIDER_PROMINENCE');
  if (classified && notable) {
    return { admitted: true, signals: [...present].sort() };
  }

  // 4. Otherwise the place is rejected with INSUFFICIENT_ADMISSION_EVIDENCE.
  return { admitted: false, reason: 'INSUFFICIENT_ADMISSION_EVIDENCE' };
}
