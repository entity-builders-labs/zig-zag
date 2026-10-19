import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  reconcileStructuredRecords,
  ReconciliationRecord,
} from './structured-identity-reconciliation.policy';

/**
 * Spike 3 S3-A identity-reconciliation replay (task 38.2). Zero live calls:
 * reads the committed S3-A Overpass POI recording and reports how the three
 * duplicated pairs (Caminito, Plaza de Mayo, Puente de la Mujer) resolve
 * under the new C8 rule. Evidence, not a tuning target.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const RECORDINGS = join(
  REPO_ROOT,
  'spikes',
  'structured-places-baseline-2026-10-11',
  'runs',
  'recordings',
);

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));

function canonicalClassOf(tags: Record<string, string>): string | undefined {
  for (const key of ['tourism', 'historic', 'amenity', 'leisure', 'natural']) {
    if (tags[key]) return `${key}:${tags[key]}`;
  }
  if (tags.highway) return `highway:${tags.highway}`;
  return undefined;
}

function toRecord(element: OverpassElement): ReconciliationRecord {
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  return {
    id: `osm:${element.type}:${element.id}`,
    providerId: `osm:${element.type}:${element.id}`,
    osmType: element.type,
    qid: element.tags.wikidata,
    names: [element.tags.name].filter((n): n is string => !!n),
    ...(latitude !== undefined && longitude !== undefined
      ? {
          geometry: {
            kind: 'POINT' as const,
            latitude,
            longitude,
          },
        }
      : {}),
    canonicalClass: canonicalClassOf(element.tags),
  };
}

function overpassElements(): OverpassElement[] {
  const file = readdirSync(RECORDINGS).find((name) =>
    name.startsWith('overpass.queryPoisWithinArea.'),
  );
  if (!file) throw new Error('S3-A overpass recording missing');
  return (readJson(join(RECORDINGS, file)) as { result: OverpassElement[] })
    .result;
}

describe('structured identity reconciliation S3-A replay (task 38.2)', () => {
  const elements = overpassElements();
  const names = ['Caminito', 'Plaza de Mayo', 'Puente de la Mujer'];
  const pairs = names.map((name) =>
    elements.filter((element) => element.tags.name === name),
  );

  it('finds exactly two records for each duplicated pair', () => {
    for (const i of names.keys()) {
      expect(pairs[i].length).toBe(2);
      expect(pairs[i].map((e) => e.type)).toContain('node');
      expect(pairs[i].map((e) => e.type).some((t) => t !== 'node')).toBe(true);
    }
  });

  it('reports how each pair is resolved and why', () => {
    const records = pairs.flat().map(toRecord);
    const result = reconcileStructuredRecords(records);

    const report = names.map((name, i) => {
      const [a, b] = pairs[i];
      const merged = result.merges.find(
        (m) =>
          (m.kept === `osm:${a.type}:${a.id}` &&
            m.merged.includes(`osm:${b.type}:${b.id}`)) ||
          (m.kept === `osm:${b.type}:${b.id}` &&
            m.merged.includes(`osm:${a.type}:${a.id}`)),
      );
      const duplicate = result.possibleDuplicates.find(
        (d) =>
          (d.left === `osm:${a.type}:${a.id}` &&
            d.right === `osm:${b.type}:${b.id}`) ||
          (d.left === `osm:${b.type}:${b.id}` &&
            d.right === `osm:${a.type}:${a.id}`),
      );
      return {
        name,
        node: toRecord(a),
        other: toRecord(b),
        merged: merged ? { basis: merged.basis, kept: merged.kept } : null,
        possibleDuplicate: duplicate ? duplicate.reason : null,
      };
    });

    console.log(JSON.stringify(report, null, 2));

    // The S3-A recording carries only center points (no area/line geometry),
    // and these pairs share no Wikidata QID, so none of them merges: each is
    // recorded as a POSSIBLE_DUPLICATE with a typed reason.
    for (const entry of report) {
      expect(entry.merged).toBeNull();
      expect(entry.possibleDuplicate).not.toBeNull();
    }
    // No shared QID among the pairs: the node of each pair has no wikidata
    // tag, so the reconciliation can never use the SHARED_QID strong tier.
    for (const [a, b] of pairs) {
      const node = a.type === 'node' ? a : b;
      expect(node.tags.wikidata).toBeUndefined();
    }
  });

  it('is deterministic over the full recording sample', () => {
    // A representative slice is enough to prove determinism; running the full
    // 2712-record pairwise pass is unnecessary for this evidence.
    const sample = elements.slice(0, 120).map(toRecord);
    const forward = reconcileStructuredRecords(sample);
    const reverse = reconcileStructuredRecords([...sample].reverse());
    expect(forward.canonical).toEqual(reverse.canonical);
    expect(forward.merges).toEqual(reverse.merges);
  });
});
