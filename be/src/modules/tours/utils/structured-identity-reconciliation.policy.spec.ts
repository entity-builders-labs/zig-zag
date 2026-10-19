import {
  reconcileStructuredRecords,
  ReconciliationRecord,
} from './structured-identity-reconciliation.policy';

const rec = (
  over: Partial<ReconciliationRecord> & { id: string },
): ReconciliationRecord => ({
  names: [],
  ...over,
});

describe('structured identity reconciliation (design C8)', () => {
  it('merges records sharing a Wikidata QID (strong evidence)', () => {
    const result = reconcileStructuredRecords([
      rec({
        id: 'osm:node:1',
        providerId: 'osm:node:1',
        osmType: 'node',
        qid: 'Q123',
        names: ['a'],
      }),
      rec({
        id: 'osm:way:2',
        providerId: 'osm:way:2',
        osmType: 'way',
        qid: 'Q123',
        names: ['a'],
      }),
    ]);
    expect(result.canonical).toEqual(['osm:way:2']);
    expect(result.merges).toEqual([
      {
        kept: 'osm:way:2',
        merged: ['osm:node:1'],
        basis: 'SHARED_QID',
        evidence: ['Q123'],
      },
    ]);
  });

  it('merges a node inside an area with the same exact name and compatible class (structural correspondence)', () => {
    const result = reconcileStructuredRecords([
      rec({
        id: 'osm:way:9',
        providerId: 'osm:way:9',
        osmType: 'way',
        names: ['Plaza Uno'],
        geometry: {
          kind: 'AREA',
          west: -58.4,
          south: -34.7,
          east: -58.3,
          north: -34.6,
        },
        canonicalClass: 'leisure:park',
      }),
      rec({
        id: 'osm:node:10',
        providerId: 'osm:node:10',
        osmType: 'node',
        names: ['Plaza Uno'],
        geometry: { kind: 'POINT', latitude: -34.65, longitude: -58.35 },
        canonicalClass: 'leisure:park',
      }),
    ]);
    expect(result.canonical).toEqual(['osm:way:9']);
    expect(result.merges.map((m) => m.basis)).toEqual([
      'STRUCTURAL_CORRESPONDENCE',
    ]);
    expect(result.merges[0].merged).toEqual(['osm:node:10']);
  });

  it('does not merge similar (non-exact) names', () => {
    const result = reconcileStructuredRecords([
      rec({
        id: 'osm:node:1',
        providerId: 'osm:node:1',
        osmType: 'node',
        names: ['Caminito'],
        geometry: { kind: 'POINT', latitude: -34.6, longitude: -58.36 },
        canonicalClass: 'tourism:attraction',
      }),
      rec({
        id: 'osm:way:2',
        providerId: 'osm:way:2',
        osmType: 'way',
        names: ['Calle Caminito'],
        geometry: {
          kind: 'AREA',
          west: -58.4,
          south: -34.7,
          east: -58.3,
          north: -34.6,
        },
        canonicalClass: 'tourism:attraction',
      }),
    ]);
    expect(result.canonical).toEqual(['osm:node:1', 'osm:way:2']);
    expect(result.merges).toEqual([]);
  });

  it('does not merge records with conflicting QIDs', () => {
    const result = reconcileStructuredRecords([
      rec({
        id: 'osm:node:1',
        providerId: 'osm:node:1',
        osmType: 'node',
        qid: 'Q1',
        names: ['X'],
        geometry: { kind: 'POINT', latitude: -34.6, longitude: -58.36 },
        canonicalClass: 'tourism:attraction',
      }),
      rec({
        id: 'osm:way:2',
        providerId: 'osm:way:2',
        osmType: 'way',
        qid: 'Q2',
        names: ['X'],
        geometry: {
          kind: 'AREA',
          west: -58.4,
          south: -34.7,
          east: -58.3,
          north: -34.6,
        },
        canonicalClass: 'tourism:attraction',
      }),
    ]);
    expect(result.merges).toEqual([]);
    expect(result.possibleDuplicates).toEqual([
      { left: 'osm:node:1', right: 'osm:way:2', reason: 'CONFLICTING_QID' },
    ]);
  });

  it('does not merge when the same name appears in several matching places (ambiguous multi-match)', () => {
    const records = [
      rec({
        id: 'osm:node:1',
        providerId: 'osm:node:1',
        osmType: 'node',
        names: ['X'],
        geometry: { kind: 'POINT', latitude: -34.65, longitude: -58.35 },
        canonicalClass: 'tourism:attraction',
      }),
      rec({
        id: 'osm:way:2',
        providerId: 'osm:way:2',
        osmType: 'way',
        names: ['X'],
        geometry: {
          kind: 'AREA',
          west: -58.4,
          south: -34.7,
          east: -58.3,
          north: -34.6,
        },
        canonicalClass: 'tourism:attraction',
      }),
      rec({
        id: 'osm:way:3',
        providerId: 'osm:way:3',
        osmType: 'way',
        names: ['X'],
        geometry: {
          kind: 'AREA',
          west: -58.4,
          south: -34.7,
          east: -58.3,
          north: -34.6,
        },
        canonicalClass: 'tourism:attraction',
      }),
    ];
    const result = reconcileStructuredRecords(records);
    expect(result.merges).toEqual([]);
    expect(
      result.possibleDuplicates.some((d) => d.reason === 'AMBIGUOUS_MATCH'),
    ).toBe(true);
  });

  it('is order-independent under shuffled input', () => {
    const mk = () => [
      rec({
        id: 'osm:way:2',
        providerId: 'osm:way:2',
        osmType: 'way',
        names: ['Plaza Uno'],
        geometry: {
          kind: 'AREA',
          west: -58.4,
          south: -34.7,
          east: -58.3,
          north: -34.6,
        },
        canonicalClass: 'leisure:park',
      }),
      rec({
        id: 'osm:node:1',
        providerId: 'osm:node:1',
        osmType: 'node',
        names: ['Plaza Uno'],
        geometry: { kind: 'POINT', latitude: -34.65, longitude: -58.35 },
        canonicalClass: 'leisure:park',
      }),
      rec({
        id: 'osm:node:3',
        providerId: 'osm:node:3',
        osmType: 'node',
        qid: 'Q9',
        names: ['Other'],
      }),
    ];
    const a = reconcileStructuredRecords(mk());
    const b = reconcileStructuredRecords([...mk()].reverse());
    expect(a.canonical).toEqual(b.canonical);
    expect(a.merges).toEqual(b.merges);
  });

  it('merges a node member of a way/relation via structural relationship', () => {
    const result = reconcileStructuredRecords([
      rec({
        id: 'osm:way:1',
        providerId: 'osm:way:1',
        osmType: 'way',
        names: ['Site'],
      }),
      rec({
        id: 'osm:node:2',
        providerId: 'osm:node:2',
        osmType: 'node',
        names: ['Entrance'],
        memberOfIds: ['osm:way:1'],
      }),
    ]);
    expect(result.merges.map((m) => m.basis)).toEqual([
      'STRUCTURAL_RELATIONSHIP',
    ]);
  });
});
