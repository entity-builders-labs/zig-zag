import { existsSync, readFileSync, writeFileSync } from 'fs';
import { CandidateFacts, DiscoveryKind } from './contracts';
import {
  AuthorityViolation,
  CatalogSnapshot,
  CatalogStore,
  ClaimType,
  FacetKey,
  GeoEntityRef,
  GeographyResolutionAuthority,
} from './spike1';

/** Revision 2 canonical keys; built only from typed fields. */
export function evaluationQuestionKey(claimType: ClaimType, candidateId: string, facetKey: FacetKey): string {
  return `Q|${claimType}|candidate=${candidateId}|facet=${facetKey}`;
}

export function discoveryKey(kind: DiscoveryKind, scopeId: string): string {
  return `DISCOVERY|${kind}|scope=${scopeId}`;
}

export interface Spike2Snapshot {
  catalog: CatalogSnapshot;
  candidates: Readonly<Record<string, CandidateFacts>>;
}

/**
 * Spike 2 catalog: the spike 1 L1-L4 store plus a typed L1 extension
 * (candidate facts: names, area class/extent, structured facts, prominence).
 * The extension accepts writes only with the geography-resolution authority,
 * i.e. only from the structured discovery boundary.
 */
export class Spike2Catalog {
  private constructor(
    readonly store: CatalogStore,
    private candidates: Record<string, CandidateFacts>,
  ) {}

  static empty(): Spike2Catalog {
    return new Spike2Catalog(new CatalogStore(), {});
  }

  static load(catalogPath: string, candidatesPath: string): Spike2Catalog {
    const store = CatalogStore.load(catalogPath);
    const candidates = existsSync(candidatesPath) ? (JSON.parse(readFileSync(candidatesPath, 'utf8')) as Record<string, CandidateFacts>) : {};
    return new Spike2Catalog(store, candidates);
  }

  save(catalogPath: string, candidatesPath: string): void {
    this.store.save(catalogPath);
    writeFileSync(candidatesPath, JSON.stringify(this.candidates, null, 2));
  }

  snapshot(): Spike2Snapshot {
    return { catalog: this.store.snapshot(), candidates: structuredClone(this.candidates) };
  }

  /**
   * Records a structured candidate: L1 entity (deduplicated by provider
   * identity) plus its typed facts. Returns the canonical entity, which may
   * be an existing one sharing an identity; facts merge by strong identity.
   */
  recordCandidate(token: GeographyResolutionAuthority, entity: GeoEntityRef, facts: Omit<CandidateFacts, 'geoEntityId'>): GeoEntityRef {
    if (!(token instanceof GeographyResolutionAuthority)) throw new AuthorityViolation('candidate write rejected: missing GeographyResolutionAuthority');
    const canonical = this.store.recordGeoEntity(token, entity);
    const existing = this.candidates[canonical.id];
    if (!existing) {
      this.candidates[canonical.id] = { ...structuredClone(facts), geoEntityId: canonical.id };
      return canonical;
    }
    const merged: CandidateFacts = {
      ...existing,
      names: [...new Set([...existing.names, ...facts.names])],
      parentAreaIds: [...new Set([...existing.parentAreaIds, ...facts.parentAreaIds])].sort(),
      discoveredBy: {
        ...existing.discoveredBy,
        strategies: [...new Set([...existing.discoveredBy.strategies, ...facts.discoveredBy.strategies])].sort(),
      },
      wikidataQid: existing.wikidataQid ?? facts.wikidataQid,
      facts: dedupeFacts([...existing.facts, ...facts.facts]),
      prominence: {
        sitelinks: existing.prominence.sitelinks ?? facts.prominence.sitelinks,
        tagSignals: [...new Set([...existing.prominence.tagSignals, ...facts.prominence.tagSignals])].sort(),
      },
    };
    this.candidates[canonical.id] = merged;
    return canonical;
  }

  /** Adds structured facts to an existing candidate (same authority). */
  addFacts(token: GeographyResolutionAuthority, geoEntityId: string, update: Pick<CandidateFacts, 'facts'> & { sitelinks?: number; names?: string[] }): void {
    if (!(token instanceof GeographyResolutionAuthority)) throw new AuthorityViolation('candidate write rejected: missing GeographyResolutionAuthority');
    const existing = this.candidates[geoEntityId];
    if (!existing) return;
    existing.facts = dedupeFacts([...existing.facts, ...update.facts]);
    if (update.sitelinks !== undefined) existing.prominence.sitelinks = update.sitelinks;
    if (update.names) existing.names = [...new Set([...existing.names, ...update.names])];
  }
}

function dedupeFacts(facts: CandidateFacts['facts']): CandidateFacts['facts'] {
  const seen = new Map<string, CandidateFacts['facts'][number]>();
  for (const f of facts) seen.set(`${f.source}|${f.recordId}|${f.field}|${f.value}`, f);
  return [...seen.values()].sort((a, b) => `${a.recordId}${a.field}${a.value}`.localeCompare(`${b.recordId}${b.field}${b.value}`));
}
