export type ExperienceAcquisitionProvider =
  | 'wikivoyage'
  | 'osm'
  | 'wikidata'
  | 'google_places'
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
