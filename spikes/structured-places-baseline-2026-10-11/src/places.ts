import { existsSync, readFileSync, writeFileSync } from 'fs';
import { OsmCandidate } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { ADMISSION_POLICY_VERSION, AdmissionRecord, DuplicateCollapse, admit, dedupe } from './admission';
import {
  AuthorityViolation,
  CompositionPolicy,
  GeoEntityRef,
  GeographyResolutionAuthority,
  OsmStructuredAdapter,
  ReusableCompositionAuthority,
  ReusableExperience,
  Spike2Catalog,
  StructuredFact,
  WikidataFactsAdapter,
  osmNames,
  placeVisitKey,
} from './reuse';

const GEOGRAPHY = new GeographyResolutionAuthority();
const COMPOSITION = new ReusableCompositionAuthority();

/** Writes to the admission ledger require this token (single writer: structured admission). */
export class StructuredAdmissionAuthority {
  readonly layer = 'ADMISSION' as const;
}

export class AdmissionLedger {
  private constructor(private records: Record<string, AdmissionRecord>) {}
  static empty(): AdmissionLedger { return new AdmissionLedger({}); }
  static load(path: string): AdmissionLedger { return new AdmissionLedger(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}); }
  save(path: string): void { writeFileSync(path, JSON.stringify(this.records, null, 2)); }
  record(token: StructuredAdmissionAuthority, r: AdmissionRecord): void {
    if (!(token instanceof StructuredAdmissionAuthority)) throw new AuthorityViolation('admission write rejected: missing StructuredAdmissionAuthority');
    this.records[r.placeId] = structuredClone(r);
  }
  all(): AdmissionRecord[] { return Object.values(structuredClone(this.records)).sort((a, b) => a.placeId.localeCompare(b.placeId)); }
  admitted(): AdmissionRecord[] { return this.all().filter((r) => r.admitted); }
}

export interface PlaceDiscoveryOutcome {
  status: 'SUCCESS' | 'EMPTY' | 'FAILED';
  raw: number;
  canonical: number;
  collapses: DuplicateCollapse[];
  admitted: number;
  rejectedByReason: Record<string, number>;
  failure?: string;
  wikidataQids: number;
  wikidataStatus: 'SUCCESS' | 'SKIPPED' | 'FAILED';
}

/**
 * Destination-scope structured place discovery + canonical dedupe +
 * structured admission (design S1/S3). Writes L1 only for admitted places,
 * with typed facts; no LLM, no web.
 */
export async function discoverAndAdmitPlaces(deps: {
  catalog: Spike2Catalog;
  ledger: AdmissionLedger;
  osm: OsmStructuredAdapter;
  wikidata: WikidataFactsAdapter;
  destination: GeoEntityRef;
  destinationBoundary: OsmCandidate;
}): Promise<PlaceDiscoveryOutcome> {
  const token = new StructuredAdmissionAuthority();
  let records;
  try {
    records = await deps.osm.pois(deps.destinationBoundary);
  } catch (error) {
    return { status: 'FAILED', raw: 0, canonical: 0, collapses: [], admitted: 0, rejectedByReason: {}, failure: (error as Error).message, wikidataQids: 0, wikidataStatus: 'SKIPPED' };
  }
  const { canonical, collapses } = dedupe(records);
  const rejectedByReason: Record<string, number> = {};
  for (const c of collapses) {
    rejectedByReason.DUPLICATE_OF = (rejectedByReason.DUPLICATE_OF ?? 0) + 1;
    deps.ledger.record(token, {
      placeId: `geo:${c.dropped}`, externalId: c.dropped, name: records.find((r) => r.externalId === c.dropped)?.name ?? '', admitted: false, reason: 'DUPLICATE_OF',
      detail: `${c.kept} (${c.basis})`, structuralKind: 'N/A', policyVersion: ADMISSION_POLICY_VERSION, provenance: { providerIds: [c.dropped], fields: {} },
    });
  }
  const admittedRecords = [];
  for (const r of canonical) {
    const decision = admit(r, deps.destination.geometry);
    deps.ledger.record(token, decision);
    if (!decision.admitted) { rejectedByReason[decision.reason as string] = (rejectedByReason[decision.reason as string] ?? 0) + 1; continue; }
    admittedRecords.push(r);
    const facts: StructuredFact[] = ['tourism', 'historic', 'amenity', 'leisure', 'heritage', 'natural']
      .filter((k) => r.tags[k]).map((k) => ({ source: 'openstreetmap' as const, recordId: r.externalId, field: `tag:${k}`, value: r.tags[k] }));
    const point = r.center as { lat: number; lng: number };
    deps.catalog.recordCandidate(GEOGRAPHY, {
      id: decision.placeId, kind: 'PLACE', name: r.name, identities: [{ provider: 'openstreetmap', externalId: r.externalId }],
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] }, centroid: { lng: point.lng, lat: point.lat },
    }, {
      kind: 'PLACE', names: osmNames(r), parentAreaIds: [deps.destination.id], discoveredBy: { kind: 'PLACE', scopeId: deps.destination.id, strategies: ['osm-pois'] },
      ...(r.tags.wikidata ? { wikidataQid: r.tags.wikidata } : {}), facts, prominence: { tagSignals: ['tourism', 'historic'].filter((k) => r.tags[k]).map((k) => `${k}:${r.tags[k]}`) },
    });
  }
  // Wikidata facts for linked admitted places (heritage designation, weak prominence).
  const qids = [...new Set(admittedRecords.map((r) => r.tags.wikidata).filter((q): q is string => !!q && /^Q\d+$/.test(q)))];
  let wikidataStatus: PlaceDiscoveryOutcome['wikidataStatus'] = 'SKIPPED';
  if (qids.length) {
    try {
      const facts = await deps.wikidata.facts(qids, 'discovery');
      const snapshot = deps.catalog.snapshot();
      for (const c of Object.values(snapshot.candidates)) {
        const f = c.wikidataQid ? facts.get(c.wikidataQid) : undefined;
        if (!f) continue;
        deps.catalog.addFacts(GEOGRAPHY, c.geoEntityId, {
          facts: [
            ...f.heritage.map((h) => ({ source: 'wikidata' as const, recordId: f.qid, field: 'P1435', value: h.qid, label: h.label })),
            ...(f.museumClass ? [{ source: 'wikidata' as const, recordId: f.qid, field: 'class:museum', value: 'true' }] : []),
          ],
          sitelinks: f.sitelinks,
        });
      }
      wikidataStatus = 'SUCCESS';
    } catch {
      wikidataStatus = 'FAILED';
    }
  }
  return {
    status: admittedRecords.length ? 'SUCCESS' : 'EMPTY', raw: records.length, canonical: canonical.length, collapses,
    admitted: admittedRecords.length, rejectedByReason, wikidataQids: qids.length, wikidataStatus,
  };
}

/**
 * PLACE_VISIT derivation from admitted places (design S8): identity = the
 * canonical place, justification = the structured admission record, zero L2
 * required. L2 assertions about the place, when present, only add facet keys
 * (a content revision), never gate existence.
 */
export function composePlaceVisits(catalog: Spike2Catalog, ledger: AdmissionLedger, policy: CompositionPolicy): { created: number; revised: number; unchanged: number; archived: number } {
  const snapshot = catalog.snapshot();
  const admitted = new Map(ledger.admitted().map((r) => [r.placeId, r]));
  const report = { created: 0, revised: 0, unchanged: 0, archived: 0 };
  for (const [placeId, record] of [...admitted.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const place = snapshot.catalog.geoEntities[placeId];
    if (!place) continue;
    const enrichmentFacets = Object.values(snapshot.catalog.assertions)
      .filter((a) => a.status === 'ACTIVE' && ((a.subject.kind === 'GEO_ENTITY' && a.subject.geoEntityId === placeId) || (a.subject.kind === 'PLACE_IN_AREA' && a.subject.placeGeoEntityId === placeId)))
      .map((a) => a.facetKey);
    const experience: ReusableExperience = {
      key: placeVisitKey(placeId), unitKind: 'PLACE_VISIT', anchors: [placeId],
      justification: [`ADMISSION|${placeId}|${record.policyVersion}`], contentRevision: 1, policyVersion: policy.version, status: 'ACTIVE',
      content: {
        name: place.name, stops: [{ geoEntityId: placeId, name: place.name, point: place.centroid, required: true }],
        durationMinutes: policy.placeVisitDwellMinutes, footprint: { type: 'POINT', point: place.centroid }, facetKeys: [...new Set(enrichmentFacets)].sort(),
      },
    };
    const outcome = catalog.store.upsertExperience(COMPOSITION, experience);
    if (outcome === 'CREATED') report.created += 1; else if (outcome === 'UNCHANGED') report.unchanged += 1; else report.revised += 1;
  }
  for (const e of Object.values(snapshot.catalog.experiences)) {
    if (e.unitKind === 'PLACE_VISIT' && !admitted.has(e.anchors[0]) && catalog.store.archiveExperience(COMPOSITION, e.key)) report.archived += 1;
  }
  return report;
}
