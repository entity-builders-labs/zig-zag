import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  Assertion,
  EvidenceCapture,
  GeoEntityRef,
  LedgerEntry,
  ReusableExperience,
} from './contracts';

/**
 * Single-writer authorities (design D3). Each layer accepts writes only
 * with its authority token; a write with any other token throws. Tokens are
 * classes so the check holds at runtime as well as in the type system.
 */
export class GeographyResolutionAuthority {
  readonly layer = 'L1' as const;
}
export class GroundingAuthority {
  readonly layer = 'L2' as const;
}
export class GapOutcomeRecordingAuthority {
  readonly layer = 'L3' as const;
}
export class ReusableCompositionAuthority {
  readonly layer = 'L4' as const;
}

export class AuthorityViolation extends Error {}

function requireAuthority(token: unknown, expected: new () => object, layer: string) {
  if (!(token instanceof expected)) {
    throw new AuthorityViolation(`${layer} write rejected: missing ${expected.name}`);
  }
}

export interface CatalogState {
  epoch: number;
  geoEntities: Record<string, GeoEntityRef>;
  /** provider:externalId -> geoEntityId */
  identityIndex: Record<string, string>;
  assertions: Record<string, Assertion>;
  ledger: Record<string, LedgerEntry[]>;
  experiences: Record<string, ReusableExperience>;
}

/** A read-only snapshot: a deep copy plus the epoch it was read at. */
export type CatalogSnapshot = Readonly<CatalogState>;

export function emptyCatalogState(): CatalogState {
  return {
    epoch: 0,
    geoEntities: {},
    identityIndex: {},
    assertions: {},
    ledger: {},
    experiences: {},
  };
}

export type UpsertAssertionOutcome = 'CREATED' | 'EVIDENCE_MERGED' | 'UNCHANGED';
export type UpsertExperienceOutcome = 'CREATED' | 'REVISED' | 'UNCHANGED' | 'REACTIVATED';

export class CatalogStore {
  private state: CatalogState;

  constructor(initial?: CatalogState) {
    this.state = initial ? structuredClone(initial) : emptyCatalogState();
  }

  static load(path: string): CatalogStore {
    if (!existsSync(path)) return new CatalogStore();
    return new CatalogStore(JSON.parse(readFileSync(path, 'utf8')) as CatalogState);
  }

  save(path: string): void {
    writeFileSync(path, JSON.stringify(this.state, null, 2));
  }

  snapshot(): CatalogSnapshot {
    return structuredClone(this.state);
  }

  get epoch(): number {
    return this.state.epoch;
  }

  // ---- L1 -------------------------------------------------------------

  /** Records a resolved entity, reusing an existing one with a shared identity. */
  recordGeoEntity(token: GeographyResolutionAuthority, entity: GeoEntityRef): GeoEntityRef {
    requireAuthority(token, GeographyResolutionAuthority, 'L1');
    if (entity.identities.length === 0) {
      throw new AuthorityViolation('L1 entity without provider identity');
    }
    for (const identity of entity.identities) {
      const existingId = this.state.identityIndex[`${identity.provider}:${identity.externalId}`];
      if (existingId) return structuredClone(this.state.geoEntities[existingId]);
    }
    this.state.geoEntities[entity.id] = structuredClone(entity);
    for (const identity of entity.identities) {
      this.state.identityIndex[`${identity.provider}:${identity.externalId}`] = entity.id;
    }
    this.state.epoch += 1;
    return structuredClone(entity);
  }

  // ---- L2 -------------------------------------------------------------

  /**
   * Idempotent by assertion key: an equivalent claim adds its evidence
   * captures (deduplicated by locator + span/field fingerprint) instead of
   * creating a parallel assertion.
   */
  upsertAssertion(token: GroundingAuthority, assertion: Assertion): UpsertAssertionOutcome {
    requireAuthority(token, GroundingAuthority, 'L2');
    const existing = this.state.assertions[assertion.key];
    if (!existing) {
      this.state.assertions[assertion.key] = structuredClone(assertion);
      this.state.epoch += 1;
      return 'CREATED';
    }
    const known = new Set(existing.evidence.map(evidenceIdentity));
    const added = assertion.evidence.filter((e) => !known.has(evidenceIdentity(e)));
    const reactivated = existing.status === 'RETRACTED' && assertion.status === 'ACTIVE';
    if (added.length === 0 && !reactivated) return 'UNCHANGED';
    existing.evidence.push(...structuredClone(added));
    if (reactivated) existing.status = 'ACTIVE';
    this.state.epoch += 1;
    return 'EVIDENCE_MERGED';
  }

  retractAssertion(token: GroundingAuthority, key: string): void {
    requireAuthority(token, GroundingAuthority, 'L2');
    const existing = this.state.assertions[key];
    if (!existing || existing.status === 'RETRACTED') return;
    existing.status = 'RETRACTED';
    this.state.epoch += 1;
  }

  // ---- L3 -------------------------------------------------------------

  recordGapOutcome(token: GapOutcomeRecordingAuthority, entry: LedgerEntry): void {
    requireAuthority(token, GapOutcomeRecordingAuthority, 'L3');
    (this.state.ledger[entry.gapKey] ??= []).push(structuredClone(entry));
    this.state.epoch += 1;
  }

  // ---- L4 -------------------------------------------------------------

  upsertExperience(
    token: ReusableCompositionAuthority,
    experience: ReusableExperience,
  ): UpsertExperienceOutcome {
    requireAuthority(token, ReusableCompositionAuthority, 'L4');
    const existing = this.state.experiences[experience.key];
    if (!existing) {
      this.state.experiences[experience.key] = structuredClone({ ...experience, contentRevision: 1 });
      this.state.epoch += 1;
      return 'CREATED';
    }
    const sameContent =
      JSON.stringify(existing.content) === JSON.stringify(experience.content) &&
      JSON.stringify(existing.justification) === JSON.stringify(experience.justification) &&
      existing.policyVersion === experience.policyVersion;
    if (sameContent && existing.status === 'ACTIVE') return 'UNCHANGED';
    const outcome: UpsertExperienceOutcome = existing.status === 'ARCHIVED' ? 'REACTIVATED' : 'REVISED';
    this.state.experiences[experience.key] = structuredClone({
      ...experience,
      contentRevision: sameContent ? existing.contentRevision : existing.contentRevision + 1,
      status: 'ACTIVE',
    });
    this.state.epoch += 1;
    return outcome;
  }

  archiveExperience(token: ReusableCompositionAuthority, key: string): boolean {
    requireAuthority(token, ReusableCompositionAuthority, 'L4');
    const existing = this.state.experiences[key];
    if (!existing || existing.status === 'ARCHIVED') return false;
    existing.status = 'ARCHIVED';
    this.state.epoch += 1;
    return true;
  }
}

function evidenceIdentity(e: EvidenceCapture): string {
  const locator = e.locator.kind === 'URL' ? e.locator.url : `${e.locator.dataset}/${e.locator.recordId}/${e.locator.fieldPath}`;
  const body =
    e.capture.kind === 'PROSE_SPAN'
      ? `span:${e.capture.text.replace(/\s+/g, ' ').trim()}`
      : `fields:${JSON.stringify(e.capture.values)}`;
  return `${locator}#${body}`;
}
