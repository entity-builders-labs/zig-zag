import { structuralKindFromOsmTags } from '../../../be/src/modules/tours/utils/candidate-structural-kind.util';
import { GeoGeometry, LngLat, OsmRecord, containsPoint } from './reuse';

/**
 * Structured place admission (spec `structured-place-admission`, design S3,
 * owner decision Q1). Deterministic, versioned, no LLM, no web evidence.
 */
export const ADMISSION_POLICY_VERSION = 'admission-spike3-1';

/**
 * Lodging values the backend excludes from tourism POIs. Mirrors the
 * non-exported `NON_EXPERIENCE_TOURISM_VALUES` in
 * be/src/modules/integrations/osm/utils/overpass-query.util.ts. Production
 * must export and reuse that single source instead of this copy.
 */
const LODGING = new Set(['hotel', 'hostel', 'guest_house', 'motel', 'apartment', 'camp_site', 'caravan_site', 'chalet', 'wilderness_hut']);

/** Non-visitable tourism infrastructure (Q1 exclusion): boards, maps, guideposts, offices. */
const NON_VISITABLE_TOURISM = new Set(['information']);

/** Canonical structural kinds that exclude a record (Q1 exclusions). */
const EXCLUDED_KINDS = new Set(['TRANSPORT_STOP', 'ROAD', 'SETTLEMENT', 'ADMINISTRATIVE_AREA', 'POSTAL_UNIT']);

export type AdmissionRejection =
  | 'NO_CANONICAL_IDENTITY'
  | 'NO_NAME'
  | 'NO_COORDINATES'
  | 'OUTSIDE_DESTINATION'
  | 'EXCLUDED_CATEGORY'
  | 'UNKNOWN_CATEGORY'
  | 'DUPLICATE_OF';

export interface AdmissionRecord {
  placeId: string;
  externalId: string;
  name: string;
  admitted: boolean;
  reason?: AdmissionRejection;
  detail?: string;
  /** Admissible backend tourism class, e.g. `tourism:museum`. */
  admissionClass?: string;
  structuralKind: string;
  policyVersion: string;
  /** Structured provenance: provider ids and the fields admission relied on. */
  provenance: { providerIds: string[]; fields: Record<string, string> };
}

/** Admissible class from the backend's tourism POI vocabulary, or undefined. */
export function admissionClass(tags: Record<string, string>): string | undefined {
  if (tags.tourism && !LODGING.has(tags.tourism) && !NON_VISITABLE_TOURISM.has(tags.tourism)) return `tourism:${tags.tourism}`;
  if (tags.historic) return `historic:${tags.historic}`;
  if (tags.amenity === 'marketplace' || tags.amenity === 'place_of_worship') return `amenity:${tags.amenity}`;
  if (tags.leisure === 'park' || tags.leisure === 'square' || tags.leisure === 'beach_resort') return `leisure:${tags.leisure}`;
  if (tags.natural === 'beach') return 'natural:beach';
  return undefined;
}

function excludedCategory(tags: Record<string, string>, kind: string): string | undefined {
  if (tags.tourism && LODGING.has(tags.tourism)) return `accommodation (tourism=${tags.tourism})`;
  if (EXCLUDED_KINDS.has(kind)) return `structural kind ${kind}`;
  if (tags.tourism && NON_VISITABLE_TOURISM.has(tags.tourism) && !admissionClass(tags)) return `non-visitable infrastructure (tourism=${tags.tourism})`;
  return undefined;
}

const OSM_ID = /^osm:(node|way|relation):[1-9]\d*$/;

/** Admits or rejects one canonical record (already deduplicated). */
export function admit(record: OsmRecord, destination: GeoGeometry): AdmissionRecord {
  const kind = structuralKindFromOsmTags(record.tags);
  const base = {
    placeId: `geo:${record.externalId}`,
    externalId: record.externalId,
    name: record.name,
    structuralKind: kind,
    policyVersion: ADMISSION_POLICY_VERSION,
    provenance: { providerIds: [record.externalId], fields: {} as Record<string, string> },
  };
  const reject = (reason: AdmissionRejection, detail?: string): AdmissionRecord => ({ ...base, admitted: false, reason, ...(detail ? { detail } : {}) });
  if (!OSM_ID.test(record.externalId)) return reject('NO_CANONICAL_IDENTITY');
  if (!record.name || !record.name.trim()) return reject('NO_NAME');
  if (!record.center) return reject('NO_COORDINATES');
  const point: LngLat = { lng: record.center.lng, lat: record.center.lat };
  if (!containsPoint(destination, point)) return reject('OUTSIDE_DESTINATION');
  const excluded = excludedCategory(record.tags, kind);
  if (excluded) return reject('EXCLUDED_CATEGORY', excluded);
  const cls = admissionClass(record.tags);
  if (!cls) return reject('UNKNOWN_CATEGORY', JSON.stringify(record.tags).slice(0, 120));
  const [key, value] = cls.split(':');
  return {
    ...base,
    admitted: true,
    admissionClass: cls,
    provenance: {
      providerIds: [record.externalId],
      fields: { name: record.name, [key]: value, lat: String(point.lat), lng: String(point.lng), ...(record.tags.wikidata ? { wikidata: record.tags.wikidata } : {}) },
    },
  };
}

export interface DuplicateCollapse {
  kept: string;
  dropped: string;
  basis: 'osm-id' | `wikidata:${string}`;
}

/**
 * Deduplication by strong provider identity only: the same OSM element
 * returned twice, or several OSM elements linked to the same Wikidata item.
 * Never by name or proximity. Keeps way/relation over node, then lowest id.
 */
export function dedupe(records: OsmRecord[]): { canonical: OsmRecord[]; collapses: DuplicateCollapse[] } {
  const collapses: DuplicateCollapse[] = [];
  const byId = new Map<string, OsmRecord>();
  for (const r of records) {
    if (byId.has(r.externalId)) collapses.push({ kept: r.externalId, dropped: r.externalId, basis: 'osm-id' });
    else byId.set(r.externalId, r);
  }
  const rank = (r: OsmRecord) => (r.osmType === 'node' ? 1 : 0);
  const byQid = new Map<string, OsmRecord[]>();
  const canonical: OsmRecord[] = [];
  for (const r of [...byId.values()].sort((a, b) => a.externalId.localeCompare(b.externalId))) {
    const q = r.tags.wikidata;
    if (q && /^Q\d+$/.test(q)) byQid.set(q, [...(byQid.get(q) ?? []), r]);
    else canonical.push(r);
  }
  for (const [q, group] of [...byQid.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...group].sort((a, b) => rank(a) - rank(b) || a.osmId - b.osmId);
    canonical.push(sorted[0]);
    for (const d of sorted.slice(1)) collapses.push({ kept: sorted[0].externalId, dropped: d.externalId, basis: `wikidata:${q}` });
  }
  return { canonical: canonical.sort((a, b) => a.externalId.localeCompare(b.externalId)), collapses };
}
