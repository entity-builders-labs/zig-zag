import {
  EquivalenceItemFacts,
  EquivalenceRecord,
  groupEquivalentRecords,
  itemsNeedingFacts,
} from './record-identity-equivalence.policy';
import { osmEquivalenceRecord } from './nominatim-match.util';
import { bestNameCorrespondence } from './identity-name-correspondence.util';

/**
 * Record equivalence (RW4-ID-RECALL-CABILDO-1). Fixtures are generic
 * records; the real Cabildo / FADU-Exactas shapes are pinned in the
 * resolver spec.
 */
/** Fixtures are OSM-shaped and go through the real OSM boundary. */
const record = (id: string, tags: Record<string, string>): EquivalenceRecord =>
  osmEquivalenceRecord({ id, name: tags.name, tags });
const at = (street: string, number: string) => ({
  'addr:street': street,
  'addr:housenumber': number,
});
const ITEM: EquivalenceItemFacts = {
  located: true,
  names: ['Kestrel Hall', 'Kestrel Hall Museum'],
};
const facts = (item: EquivalenceItemFacts = ITEM) => new Map([['Q9', item]]);

const MUSEUM = record('osm:node:1', {
  name: 'Kestrel Hall Museum',
  wikidata: 'Q9',
  ...at('Main Street', '65'),
});
const BUILDING = record('osm:way:2', {
  name: 'Kestrel Hall',
  short_name: 'Kestrel',
  wikidata: 'Q9',
  ...at('Main  street', '65'),
});

describe('groupEquivalentRecords', () => {
  it('1. same QID + same address + both EQUIVALENT to the item -> one identity', () => {
    const grouping = groupEquivalentRecords([MUSEUM, BUILDING], facts());

    expect(grouping.groupOf('osm:node:1')).toEqual({
      key: 'record-group:Q9@main street 65',
      qid: 'Q9',
      address: 'main street 65',
      memberIds: ['osm:node:1', 'osm:way:2'],
      declaredNames: ['Kestrel Hall Museum', 'Kestrel Hall', 'Kestrel'],
    });
    expect(grouping.identityKeyOf('osm:way:2')).toBe(
      grouping.identityKeyOf('osm:node:1'),
    );
    expect(grouping.auditOf('osm:way:2')).toEqual({
      grouped: true,
      qid: 'Q9',
      basis: {
        sharedQid: 'Q9',
        locatedItem: true,
        exactAddress: 'main street 65',
        memberNameConsistency: 'EQUIVALENT',
      },
      members: ['osm:node:1', 'osm:way:2'],
    });
  });

  it('2. a member whose names only OVERLAP the item -> no group', () => {
    const overlapping = record('osm:node:3', {
      name: 'Kestrel Museum',
      wikidata: 'Q9',
      ...at('Main Street', '65'),
    });

    expect(bestNameCorrespondence('Kestrel Museum', ITEM.names)).toBe(
      'OVERLAP',
    );
    const grouping = groupEquivalentRecords([BUILDING, overlapping], facts());

    expect(grouping.groupOf('osm:way:2')).toBeUndefined();
    expect(grouping.auditOf('osm:node:3')).toEqual({
      grouped: false,
      qid: 'Q9',
      reason: 'MEMBER_NAME_NOT_EQUIVALENT',
    });
  });

  it('3. a member whose names correspond NONE to the item (a mis-tagged QID) -> no group', () => {
    const misTagged = record('osm:node:4', {
      name: 'Falcon Institute',
      short_name: 'FI',
      wikidata: 'Q9',
      ...at('Main Street', '65'),
    });

    expect(bestNameCorrespondence('Falcon Institute', ITEM.names)).toBe('NONE');
    const grouping = groupEquivalentRecords([BUILDING, misTagged], facts());

    expect(grouping.groupOf('osm:way:2')).toBeUndefined();
    expect(grouping.groupOf('osm:node:4')).toBeUndefined();
    expect(grouping.auditOf('osm:node:4')).toMatchObject({
      grouped: false,
      reason: 'MEMBER_NAME_NOT_EQUIVALENT',
    });
  });

  it('a third, inconsistent record never joins two consistent ones', () => {
    const misTagged = record('osm:node:4', {
      name: 'Falcon Institute',
      wikidata: 'Q9',
      ...at('Main Street', '65'),
    });

    const grouping = groupEquivalentRecords(
      [MUSEUM, BUILDING, misTagged],
      facts(),
    );

    expect(grouping.groupOf('osm:node:1')?.memberIds).toEqual([
      'osm:node:1',
      'osm:way:2',
    ]);
    expect(grouping.groupOf('osm:node:4')).toBeUndefined();
    expect(grouping.groupOf('osm:node:1')?.declaredNames).not.toContain(
      'Falcon Institute',
    );
  });

  it('4. same QID + different address -> no group', () => {
    const elsewhere = record('osm:way:5', {
      name: 'Kestrel Hall',
      wikidata: 'Q9',
      ...at('Main Street', '66'),
    });

    const grouping = groupEquivalentRecords([MUSEUM, elsewhere], facts());

    expect(grouping.groupOf('osm:node:1')).toBeUndefined();
    expect(grouping.auditOf('osm:way:5')).toMatchObject({
      grouped: false,
      reason: 'ADDRESS_MISMATCH',
    });
  });

  it('a record without a complete address never joins', () => {
    const noNumber = record('osm:way:6', {
      name: 'Kestrel Hall',
      wikidata: 'Q9',
      'addr:street': 'Main Street',
    });

    const grouping = groupEquivalentRecords([MUSEUM, noNumber], facts());

    expect(grouping.groupOf('osm:node:1')).toBeUndefined();
    expect(grouping.auditOf('osm:way:6')).toMatchObject({
      reason: 'ADDRESS_MISSING',
    });
  });

  it('5. an item without a coordinate (P625) -> no group', () => {
    const grouping = groupEquivalentRecords(
      [MUSEUM, BUILDING],
      facts({ ...ITEM, located: false }),
    );

    expect(grouping.groupOf('osm:node:1')).toBeUndefined();
    expect(grouping.auditOf('osm:node:1')).toMatchObject({
      reason: 'QID_NOT_LOCATED',
    });
  });

  it('6. same address + different QIDs -> no group', () => {
    const neighbour = record('osm:way:7', {
      name: 'Kestrel Hall',
      wikidata: 'Q10',
      ...at('Main Street', '65'),
    });

    const grouping = groupEquivalentRecords(
      [MUSEUM, neighbour],
      new Map([
        ['Q9', ITEM],
        ['Q10', ITEM],
      ]),
    );

    expect(grouping.groupOf('osm:node:1')).toBeUndefined();
    expect(grouping.auditOf('osm:node:1')).toBeUndefined();
  });

  it('10. unknown item facts (a failed lookup) -> no group, fail closed', () => {
    const grouping = groupEquivalentRecords([MUSEUM, BUILDING], new Map());

    expect(grouping.groupOf('osm:node:1')).toBeUndefined();
    expect(grouping.auditOf('osm:node:1')).toMatchObject({
      reason: 'QID_FACTS_UNAVAILABLE',
    });
  });

  it('counts a group as one identity and every other record as itself', () => {
    const other = record('osm:node:8', { name: 'Kestrel Hall' });
    const grouping = groupEquivalentRecords([MUSEUM, BUILDING, other], facts());

    expect(grouping.countIdentities([MUSEUM, BUILDING])).toBe(1);
    expect(grouping.countIdentities([MUSEUM, BUILDING, other])).toBe(2);
  });

  it('asks for item facts only for items two or more records declare', () => {
    expect(
      itemsNeedingFacts([
        MUSEUM,
        BUILDING,
        record('osm:node:9', { name: 'Lone', wikidata: 'Q11' }),
        record('osm:node:10', { name: 'Bad', wikidata: 'not-a-qid' }),
      ]),
    ).toEqual(['Q9']);
  });

  it("the OSM boundary reads a record's own names only: name, short_name, alt_name, official_name", () => {
    expect(
      record('osm:node:11', {
        name: 'Kestrel Hall',
        short_name: 'Kestrel',
        alt_name: 'Old Hall;Hall of Kestrel',
        official_name: 'The Kestrel Hall',
        'name:en': 'Kestrel Hall EN',
        wikipedia: 'en:Kestrel Hall',
      }).ownNames,
    ).toEqual([
      'Kestrel Hall',
      'Kestrel',
      'Old Hall',
      'Hall of Kestrel',
      'The Kestrel Hall',
    ]);
  });

  it('the OSM boundary normalizes the address and ignores a malformed QID', () => {
    expect(
      record('osm:node:12', {
        name: 'Kestrel Hall',
        wikidata: 'not-a-qid',
        'addr:street': 'Main  Street',
      }),
    ).toEqual({ id: 'osm:node:12', ownNames: ['Kestrel Hall'] });
    expect(
      record('osm:node:13', { name: 'X', ...at('Bolívar', '65') }),
    ).toMatchObject({
      exactAddress: 'bolivar 65',
    });
  });
});
