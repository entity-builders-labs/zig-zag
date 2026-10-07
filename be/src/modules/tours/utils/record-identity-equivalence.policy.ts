import {
  RecordEquivalenceAudit,
  RecordEquivalenceFailure,
} from '../interfaces/experience-resolution.interface';
import { bestNameCorrespondence } from './identity-name-correspondence.util';

/**
 * The single authority for "are these provider records one physical
 * identity?" (record equivalence). It is not identity verification: it
 * never says which record a source hint means. It only lets the identity
 * resolution count one physical identity once when one dataset maps it as
 * several records (a museum node inside a building way), and lets the
 * names those records declare be read as that identity's names.
 *
 * Records of one pool are one identity only when ALL of these hold:
 *  1. they declare the same Wikidata item;
 *  2. the item is physically located (it has a coordinate, P625);
 *  3. they declare the same exact address (street + housenumber, as the
 *     provider boundary normalizes it);
 *  4. EACH record, on its own, declares a name (for OSM: `name`,
 *     `short_name`, `alt_name`, `official_name`) EQUIVALENT to the item's
 *     label or an alias. This checks the record's own consistency with the item it
 *     claims to be (a record whose names contradict its QID tag carries a
 *     mis-tag); it is never evidence that a source hint means the record.
 *
 * Unknown item facts (a failed lookup) form no group: fail closed.
 */

/**
 * A provider record as record equivalence reads it: typed facts the
 * provider boundary normalizes (see `osmEquivalenceRecord`), never raw tags.
 */
export interface EquivalenceRecord {
  id: string;
  /** The Wikidata item the record declares itself to be. */
  declaredQid?: string;
  /** Normalized street + housenumber; absent when either is missing. */
  exactAddress?: string;
  /** The names the record itself declares. */
  ownNames: string[];
}

/** What Wikidata states about one item; absent means unknown. */
export interface EquivalenceItemFacts {
  located: boolean;
  /** The item's label and aliases. */
  names: string[];
}

/** One physical identity mapped as several records. */
export interface RecordIdentityGroup {
  key: string;
  qid: string;
  address: string;
  memberIds: string[];
  /** Every own name the members declare (R2: the identity's names). */
  declaredNames: string[];
}

/** The items whose facts a grouping needs: declared by 2+ records. */
export function itemsNeedingFacts(
  records: readonly EquivalenceRecord[],
): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const qid = record.declaredQid;
    if (qid) counts.set(qid, (counts.get(qid) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([qid]) => qid);
}

/** The grouping of one pool; records outside any group are themselves. */
export class RecordIdentityGrouping {
  private constructor(
    private readonly groups: Map<string, RecordIdentityGroup>,
    private readonly audits: Map<string, RecordEquivalenceAudit>,
  ) {}

  static none(): RecordIdentityGrouping {
    return new RecordIdentityGrouping(new Map(), new Map());
  }

  static of(
    groups: Map<string, RecordIdentityGroup>,
    audits: Map<string, RecordEquivalenceAudit>,
  ): RecordIdentityGrouping {
    return new RecordIdentityGrouping(groups, audits);
  }

  groupOf(recordId: string): RecordIdentityGroup | undefined {
    return this.groups.get(recordId);
  }

  auditOf(recordId: string): RecordEquivalenceAudit | undefined {
    return this.audits.get(recordId);
  }

  /** The physical identity a record belongs to (itself when ungrouped). */
  identityKeyOf(recordId: string): string {
    return this.groups.get(recordId)?.key ?? recordId;
  }

  /** How many distinct physical identities the records span. */
  countIdentities(records: readonly { id: string }[]): number {
    return new Set(records.map((record) => this.identityKeyOf(record.id))).size;
  }
}

export function groupEquivalentRecords(
  records: readonly EquivalenceRecord[],
  itemFacts: ReadonlyMap<string, EquivalenceItemFacts>,
): RecordIdentityGrouping {
  const byQid = new Map<string, EquivalenceRecord[]>();
  for (const record of records) {
    const qid = record.declaredQid;
    if (!qid) continue;
    (byQid.get(qid) ?? byQid.set(qid, []).get(qid)!).push(record);
  }
  const groups = new Map<string, RecordIdentityGroup>();
  const audits = new Map<string, RecordEquivalenceAudit>();
  const fail = (
    qid: string,
    members: EquivalenceRecord[],
    reason: RecordEquivalenceFailure,
  ) => {
    for (const record of members)
      audits.set(record.id, { grouped: false, qid, reason });
  };

  for (const [qid, sharing] of byQid) {
    if (sharing.length < 2) continue;
    const facts = itemFacts.get(qid);
    if (!facts) {
      fail(qid, sharing, 'QID_FACTS_UNAVAILABLE');
      continue;
    }
    if (!facts.located) {
      fail(qid, sharing, 'QID_NOT_LOCATED');
      continue;
    }
    const byAddress = new Map<string, EquivalenceRecord[]>();
    for (const record of sharing) {
      const address = record.exactAddress;
      if (!address) {
        fail(qid, [record], 'ADDRESS_MISSING');
        continue;
      }
      (byAddress.get(address) ?? byAddress.set(address, []).get(address)!).push(
        record,
      );
    }
    for (const [address, sameAddress] of byAddress) {
      if (sameAddress.length < 2) {
        fail(qid, sameAddress, 'ADDRESS_MISMATCH');
        continue;
      }
      const consistent = sameAddress.filter((record) =>
        record.ownNames.some(
          (name) => bestNameCorrespondence(name, facts.names) === 'EQUIVALENT',
        ),
      );
      // A member that fails consistency never joins; without two
      // consistent members no group forms at all.
      fail(
        qid,
        sameAddress.filter((record) => !consistent.includes(record)),
        'MEMBER_NAME_NOT_EQUIVALENT',
      );
      if (consistent.length < 2) {
        fail(qid, consistent, 'MEMBER_NAME_NOT_EQUIVALENT');
        continue;
      }
      const group: RecordIdentityGroup = {
        key: `record-group:${qid}@${address}`,
        qid,
        address,
        memberIds: consistent.map((record) => record.id),
        declaredNames: [
          ...new Set(consistent.flatMap((record) => record.ownNames)),
        ],
      };
      for (const record of consistent) {
        groups.set(record.id, group);
        audits.set(record.id, {
          grouped: true,
          qid,
          basis: {
            sharedQid: qid,
            locatedItem: true,
            exactAddress: address,
            memberNameConsistency: 'EQUIVALENT',
          },
          members: group.memberIds,
        });
      }
    }
  }
  return RecordIdentityGrouping.of(groups, audits);
}
