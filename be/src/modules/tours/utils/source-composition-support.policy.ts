import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';

/**
 * Source-composition support (spec 2026-10-02 Part II §P2-18): does ONE
 * source record define every member of this composition?
 *
 * Membership of a component in an Experience is a SOURCE fact, never a
 * geometric one. When a canonical geometry corroborates a member (it lies
 * in the source-named AREA, or in the destination of a destination-local
 * Experience), the composition is already anchored in verified geography.
 * When nothing corroborates it — a source-defined composition with no
 * enclosing canonical geometry, or a member outside a DESCRIPTIVE scope and
 * outside the destination — membership rests on the source alone, and then
 * one evidence record must support EVERY member. Members supported only by
 * different records are an unsupported union of separate sources/variants,
 * however close or far apart they are.
 *
 * Inputs are only the deterministic source-support facts every hint already
 * carries: `evidenceKeys` are the VERIFIED keys of the record(s) whose text
 * contains the hint's support span (`verifyTextualComponentSourceSupport`).
 * Area-role hints are scope claims, not members, and are not counted. No
 * name, title, distance or provider fact is read. This does not judge
 * whether the shared record describes ONE coherent composition rather than
 * alternatives — that is the extraction contract's job
 * (`buildExperienceCompositionRules`, amendment §16.1).
 */
export type SourceCompositionSupport =
  | { supported: true; supportingEvidenceKeys: string[] }
  | {
      supported: false;
      reason: 'NO_SINGLE_SOURCE_RECORD_SUPPORTS_ALL_MEMBERS';
    };

export function evaluateSourceCompositionSupport(
  candidate: Pick<ExperienceCandidate, 'componentHints'>,
): SourceCompositionSupport {
  const members = (candidate.componentHints ?? []).filter(
    (hint) => hint.role !== 'area',
  );
  if (members.length === 0) {
    return {
      supported: false,
      reason: 'NO_SINGLE_SOURCE_RECORD_SUPPORTS_ALL_MEMBERS',
    };
  }
  const [first, ...rest] = members.map(
    (hint) =>
      new Set(Array.isArray(hint.evidenceKeys) ? hint.evidenceKeys : []),
  );
  const shared = [...first].filter((key) =>
    rest.every((keys) => keys.has(key)),
  );
  return shared.length > 0
    ? { supported: true, supportingEvidenceKeys: shared.sort() }
    : {
        supported: false,
        reason: 'NO_SINGLE_SOURCE_RECORD_SUPPORTS_ALL_MEMBERS',
      };
}
