export interface WikidataEntitySummary {
  qid: string;
  label?: string;
  description?: string;
  // Longer plain-text intro extract, resolved from the entity's `enwiki`
  // sitelink when one exists. Undefined when there's no English Wikipedia
  // article for this entity.
  extract?: string;
  // Every other name Wikidata records for this entity: its Spanish primary
  // label (when different from `label`, which stays English-only for
  // backward compatibility with existing narrative-enrichment callers) plus
  // en/es `skos:altLabel` aliases. Cross-source confirmation (see
  // ExperienceProposalResolverService.confirmMatch) needs this to recognize
  // a genuinely correct match whose hint/OSM name and Wikidata's primary
  // label are in different languages — `findNearbyPlaces`'s single label
  // per place cannot represent that. Undefined when Wikidata has no
  // alternate names for this entity.
  aliases?: string[];
}

export type WikidataLookupStatus = 'success' | 'partial' | 'failed';

/**
 * Keeps provider failures distinct from a valid "no entity/no article"
 * response. In particular, a Wikipedia extracts outage must not be reported
 * as if the resolved entity simply had no narrative available.
 */
export interface WikidataLookupOutcome {
  summaries: Map<string, WikidataEntitySummary>;
  status: WikidataLookupStatus;
  failedQids: Set<string>;
  extractFailedQids: Set<string>;
}

export interface WikidataEnrichmentOutcome {
  withoutQid: number;
  withQid: number;
  fetched: number;
  acceptedSafe: number;
  rejectedUnsafe: number;
  providerFailed: number;
  safetyCheckFailed: number;
  fetchedQids: Set<string>;
  safeQids: Set<string>;
  rejectedUnsafeQids: Set<string>;
  safetyCheckFailedQids: Set<string>;
}

export interface WikidataNearbyPlace {
  qid: string;
  label: string;
  latitude: number;
  longitude: number;
}

export interface IWikidataApiService {
  lookupEntitySummaries(qids: string[]): Promise<WikidataLookupOutcome>;

  /**
   * Resolves a batch of QIDs in as few HTTP calls as possible (2, not one
   * per QID — see wikidata-api.service.ts). QIDs with no matching entity
   * are simply absent from the returned Map, never thrown for.
   */
  getEntitySummaries(
    qids: string[],
  ): Promise<Map<string, WikidataEntitySummary>>;

  /**
   * Real, independent geographic confirmation signal (cross-source
   * confirmation plan, 2026-09-17): given a coordinate a DIFFERENT source
   * already claims for some named entity, ask Wikidata — a separately
   * curated database, not merely another read of the same OpenStreetMap
   * record most of this app's other geo providers ultimately share —
   * whether it independently has anything nearby. Never throws: a
   * provider outage degrades to an empty result, which the caller
   * (ExperienceProposalResolverService) must treat as "cannot confirm" —
   * never as "confirmed absent".
   */
  findNearbyPlaces(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<WikidataNearbyPlace[]>;
}
