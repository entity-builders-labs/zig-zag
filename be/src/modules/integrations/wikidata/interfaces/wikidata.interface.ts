export interface WikidataEntitySummary {
  qid: string;
  label?: string;
  description?: string;
  // Longer plain-text intro extract, resolved from the entity's `enwiki`
  // sitelink when one exists. Undefined when there's no English Wikipedia
  // article for this entity.
  extract?: string;
}

export interface IWikidataApiService {
  /**
   * Resolves a batch of QIDs in as few HTTP calls as possible (2, not one
   * per QID — see wikidata-api.service.ts). QIDs with no matching entity
   * are simply absent from the returned Map, never thrown for.
   */
  getEntitySummaries(
    qids: string[],
  ): Promise<Map<string, WikidataEntitySummary>>;
}
