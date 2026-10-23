/**
 * Single source of truth for structured catalog prominence (design C17,
 * tasks 39.3/39.4). Provider adapters translate provider records into the
 * typed facts below; this policy projects them into a per-level profile and
 * orders valid Experience candidates by it.
 *
 * Prominence is separate from identity, visit unit, admission, preference
 * relevance and planning readiness. It never decides admission, never writes
 * an admission evaluation and never persists an editorial rank. There is no
 * universal numeric score: levels are compared lexicographically, KNOWN
 * positive evidence precedes missing evidence, and UNKNOWN is never placed
 * below a known zero (absence is not negative evidence).
 */

/** Versioned identity of the ordering policy; bump on any precedence change. */
export const STRUCTURED_PROMINENCE_POLICY_VERSION =
  'structured-prominence-order-v1';

/** Canonical prominence evidence kinds (mirror the Prisma enum). */
export type ProminenceEvidenceKind =
  | 'ENCYCLOPEDIC_SITELINK_COUNT'
  | 'ENCYCLOPEDIC_LANGUAGE_SITELINK'
  | 'HERITAGE_DESIGNATION'
  | 'EXPLICIT_VISITOR_CLASSIFICATION'
  | 'PROVIDER_PROMINENCE';

/**
 * One typed structured prominence fact of a canonical place, as produced by a
 * provider adapter. `providerIdentity` is the linked provider item (for
 * example the encyclopedic item); `sourceRecordId` the record the fact was
 * read from; `fieldPath` the provider field. Kind-specific values are typed
 * fields, never a metadata bag.
 */
export interface ProminenceEvidenceFact {
  kind: ProminenceEvidenceKind;
  sourceProvider: string;
  providerIdentity: string;
  sourceRecordId: string;
  fieldPath: string;
  numericValue?: number;
  textValue?: string;
  languageCode?: string;
  authority?: string;
  designationLevel?: string;
  providerMetric?: string;
  comparisonScope?: string;
  observedAt: Date;
}

/** Stable reference to a fact, carried in explanations and traces. */
export interface ProminenceEvidenceRef {
  kind: ProminenceEvidenceKind;
  source: string;
  field: string;
  value: string | number;
}

export type PresenceLevel =
  | { status: 'KNOWN'; refs: ProminenceEvidenceRef[] }
  | { status: 'UNKNOWN' };

export type CountLevel =
  | { status: 'KNOWN'; count: number; refs: ProminenceEvidenceRef[] }
  | { status: 'UNKNOWN' };

/** Per-level typed prominence profile of one candidate. */
export interface ProminenceProfile {
  policyVersion: string;
  heritageDesignation: PresenceLevel;
  explicitVisitorClassification: PresenceLevel;
  /** No enabled provider supplies one; inert in policy v1. */
  providerProminence: { status: 'UNKNOWN' };
  encyclopedicSitelinks: CountLevel;
}

export type ProminenceLevel =
  | 'HERITAGE_DESIGNATION'
  | 'EXPLICIT_VISITOR_CLASSIFICATION'
  | 'PROVIDER_PROMINENCE'
  | 'ENCYCLOPEDIC_SITELINKS';

function refOf(fact: ProminenceEvidenceFact): ProminenceEvidenceRef {
  return {
    kind: fact.kind,
    source: `${fact.sourceProvider}:${fact.sourceRecordId}`,
    field: fact.fieldPath,
    value:
      fact.numericValue ??
      fact.designationLevel ??
      fact.textValue ??
      fact.providerIdentity,
  };
}

function byRef(a: ProminenceEvidenceRef, b: ProminenceEvidenceRef): number {
  return (
    a.source.localeCompare(b.source) ||
    a.field.localeCompare(b.field) ||
    String(a.value).localeCompare(String(b.value))
  );
}

function presence(
  facts: readonly ProminenceEvidenceFact[],
  kind: ProminenceEvidenceKind,
): PresenceLevel {
  const refs = facts.filter((fact) => fact.kind === kind).map(refOf);
  return refs.length > 0
    ? { status: 'KNOWN', refs: refs.sort(byRef) }
    : { status: 'UNKNOWN' };
}

/**
 * Projects typed facts (of one place, or the union of an Experience's required
 * VISIT components) into the per-level profile. Sitelink counts of distinct
 * linked items are not summed: the strongest recorded count is the value.
 */
export function prominenceProfile(
  facts: readonly ProminenceEvidenceFact[],
): ProminenceProfile {
  const sitelinkFacts = facts.filter(
    (fact) =>
      fact.kind === 'ENCYCLOPEDIC_SITELINK_COUNT' &&
      typeof fact.numericValue === 'number' &&
      fact.numericValue > 0,
  );
  const strongest = Math.max(0, ...sitelinkFacts.map((f) => f.numericValue!));
  return {
    policyVersion: STRUCTURED_PROMINENCE_POLICY_VERSION,
    heritageDesignation: presence(facts, 'HERITAGE_DESIGNATION'),
    explicitVisitorClassification: presence(
      facts,
      'EXPLICIT_VISITOR_CLASSIFICATION',
    ),
    providerProminence: { status: 'UNKNOWN' },
    encyclopedicSitelinks:
      sitelinkFacts.length > 0
        ? {
            status: 'KNOWN',
            count: strongest,
            refs: sitelinkFacts.map(refOf).sort(byRef),
          }
        : { status: 'UNKNOWN' },
  };
}

/** Ordering key of one level: a positive value, or 0 for no positive evidence. */
function levelKeys(
  profile: ProminenceProfile,
): Array<[ProminenceLevel, number]> {
  return [
    [
      'HERITAGE_DESIGNATION',
      profile.heritageDesignation.status === 'KNOWN' ? 1 : 0,
    ],
    [
      'EXPLICIT_VISITOR_CLASSIFICATION',
      profile.explicitVisitorClassification.status === 'KNOWN' ? 1 : 0,
    ],
    ['PROVIDER_PROMINENCE', 0],
    [
      'ENCYCLOPEDIC_SITELINKS',
      profile.encyclopedicSitelinks.status === 'KNOWN'
        ? profile.encyclopedicSitelinks.count
        : 0,
    ],
  ];
}

/**
 * Lexicographic comparison of two profiles. Negative when `a` orders first.
 * `decidingLevel` names the first level that separates them; undefined when
 * prominence does not separate them (the caller's identity tie-break applies).
 */
export function compareProminence(
  a: ProminenceProfile,
  b: ProminenceProfile,
): { order: number; decidingLevel?: ProminenceLevel } {
  const left = levelKeys(a);
  const right = levelKeys(b);
  for (let index = 0; index < left.length; index++) {
    const difference = right[index][1] - left[index][1];
    if (difference !== 0) {
      return { order: difference, decidingLevel: left[index][0] };
    }
  }
  return { order: 0 };
}

/** The profile of a candidate with no acquired prominence evidence. */
export function unknownProminenceProfile(): ProminenceProfile {
  return prominenceProfile([]);
}
