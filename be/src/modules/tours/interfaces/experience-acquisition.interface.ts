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
