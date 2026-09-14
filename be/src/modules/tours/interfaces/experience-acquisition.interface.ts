export type ExperienceAcquisitionProvider =
  | 'wikivoyage'
  | 'osm'
  | 'wikidata'
  | 'google_places'
  | 'geoapify'
  | 'web';

export type SourceEvidenceType =
  | 'tourism_activity' // Structured tourism action/experience observation
  | 'place'
  | 'route'
  | 'area'
  | 'operator'
  | 'editorial';

export interface SourceObservationGeo {
  latitude?: number;
  longitude?: number;
  geometry?: unknown;
}

/**
 * A 0..5 star-rating-style consumer signal, when the source provides one.
 * Evidence-typed (`consumerRating`), not provider-typed -- any provider
 * capable of supplying an equivalent rating (Google, Geoapify, a future
 * review aggregator) populates the SAME shape (`docs/architecture/
 * engineering-principles.md` §3).
 */
export interface RatingEvidence {
  value: number;
  reviewCount?: number;
}

/** The source is itself a curated/editorial listing (e.g. a Wikivoyage entry). */
export interface EditorialListingEvidence {
  listed: true;
}

/** A notability/popularity count (e.g. Wikidata sitelinks). */
export interface NotabilityEvidence {
  count: number;
}

/**
 * A canonical, cross-provider external identity for this observation's
 * subject, when the adapter that produced this observation can supply one
 * (e.g. a resolved Wikidata QID cited by a Wikivoyage entry, or a future
 * dedicated Wikidata provider's own subject). Populated ONLY at the
 * adapter boundary that actually resolved the identity -- domain code
 * (corroboration, dedup) consumes this typed fact directly and must never
 * branch on `SourceObservation.provider` or decode `externalId`/
 * `evidenceKey` to reconstruct it.
 */
export interface CanonicalIdentity {
  wikidataQid?: string;
}

/**
 * Normalized, provider-neutral quality evidence a single structured
 * observation may carry. Every field is independently optional -- the
 * ADAPTER that produced the observation (`GooglePlacesAcquisitionProvider`,
 * `WikivoyageAcquisitionProvider`, ...) populates only what it actually has
 * and never invents a signal it cannot supply. Downstream domain code
 * (synthesis, corroboration, quality scoring) consumes this typed fact and
 * must never branch on `SourceObservation.provider` or decode
 * `SourceObservation.metadata` to reconstruct it.
 */
export interface QualityEvidence {
  consumerRating?: RatingEvidence;
  editorialListing?: EditorialListingEvidence;
  notability?: NotabilityEvidence;
}

export interface SourceObservation {
  provider: ExperienceAcquisitionProvider;
  externalId?: string;
  title: string;
  description?: string;
  geo?: SourceObservationGeo;
  evidenceType: SourceEvidenceType;
  evidenceKey: string;
  metadata?: Record<string, unknown>;
  /**
   * Normalized quality evidence, populated by the provider adapter that
   * produced this observation (never inferred later from `provider`/
   * `metadata`). See `QualityEvidence`.
   */
  qualityEvidence?: QualityEvidence;
  /**
   * Canonical cross-provider identity, populated by the adapter that
   * resolved it. See `CanonicalIdentity`.
   */
  canonicalIdentity?: CanonicalIdentity;
  /**
   * The subject's own real external URL (e.g. a Google/Geoapify Places
   * `websiteUri`), populated by the adapter that produced this observation.
   * Downstream domain code (evidence construction, classification) reads
   * this typed fact directly and must never decode `metadata` to
   * reconstruct it.
   */
  sourceUrl?: string;
  /**
   * Provider-neutral: `false` marks an observation whose evidence is only
   * enough to CORROBORATE/enrich a tourism Experience found by stronger
   * evidence, not to ORIGINATE one on its own — e.g. a Google Places result
   * admitted solely because the acquisition plan requested a contextual
   * commercial type (`restaurant`/`cafe`/`bar`/`bakery`/`night_club`) with no
   * `SAFE_GENERIC_TOURISM_TYPES` signal. Absent / `true` = a standalone
   * candidate may be synthesized from it. Driven by source type semantics
   * only — never ratings or brand names.
   */
  standaloneEligible?: boolean;
}

export interface AcquisitionProviderResult<T> {
  status: 'success' | 'failed';
  value: T[];
  failureReason?: string;
  /**
   * Optional, provider-neutral structured provenance for trace / Bitácora
   * reconstruction (counts, resolved concepts, effective request scope, …).
   * Never raw provider payloads, secrets, or preference semantics. Currently
   * populated by the OSM acquisition provider; other providers may omit it.
   */
  provenance?: Record<string, unknown>;
}
