import { ComponentIdentityContext } from '../interfaces/component-identity-context.interface';
import {
  CompetitorPool,
  CompetitorPoolMember,
  EntityCandidate,
  IdentityEvidence,
  ResolutionStrategy,
} from '../interfaces/experience-resolution.interface';
import {
  kindCompatibility,
  localityRelation,
} from './contextual-identity.policy';
import {
  bestNameCorrespondence,
  nameCorrespondence,
} from './identity-name-correspondence.util';
import { normalizeGeoName } from './nominatim-match.util';
import { evaluateStructuralCompatibility } from './place-structural-compatibility.policy';
import { strongIdentitiesOf, strongIdentityKey } from './strong-identity.util';

export type CompetitorExamination = Extract<
  IdentityEvidence,
  { type: 'COMPETITOR_EXAMINATION' }
>;

/**
 * The single authority for what the pools examined for one hint establish
 * about competitors of one candidate. Pure: no acquisition, no ranking, no
 * score. IdentityVerifier interprets the fact it produces.
 *
 * A member is a material competitor when it answers to the hint's name or
 * to the candidate's own name (or declares a hint alias) at least as well as
 * the candidate itself does, can structurally
 * be the hinted kind of component (`evaluateStructuralCompatibility`, the
 * same authority that gates PLACE selection -- a stop named after a plaza
 * cannot be the plaza, so it never blocks the plaza's identity), lies
 * inside the component's admission scope (`admits`, the canonical
 * admission policy), is not excluded by a component-specific source fact
 * (outside a grounded locality, a structure contradicting a stated kind),
 * and is not the candidate. The destination is never such a fact: it
 * excludes only what admission excludes.
 *
 * Records are never merged by name, brand, website, phone or proximity:
 * two records of one pool are two identities unless they share a strong
 * identity key. A member of another namespace that may be the candidate
 * itself (a lone Nominatim node versus a Places record that declared no
 * OSM cross-reference) is not counted, because whether it is a competitor
 * is unknown.
 *
 * "As well as the candidate" (RW4-ID-FALSE-VERIFY-2): a candidate whose own
 * name and aliases only OVERLAP the hint was admitted at retrieval grade,
 * so every other record answering to the hint at that grade is an equally
 * good reading of the source. Counting only exact names would measure the
 * uniqueness of the candidate's name, not of the hint's referent (C3:
 * "Club Atletico" -> San Lorenzo Sede Boedo while the pool held Club
 * Atletico Atlanta, the "Club Atletico" memorial and a San Lorenzo
 * museum). A candidate that answers EQUIVALENTLY keeps the exact-name
 * competitor set; nothing here changes for it.
 */
export function examineCompetitors(input: {
  hintName: string;
  /** The hint's expected component kind (PLACE, AREA, ROUTE). */
  expectedKind?: string;
  candidate: EntityCandidate;
  pools: readonly CompetitorPool[];
  context: ComponentIdentityContext;
  admits: (member: CompetitorPoolMember) => boolean;
}): CompetitorExamination {
  const candidateKeys = new Set(
    strongIdentitiesOf(input.candidate).map(strongIdentityKey),
  );
  const candidateNamespaces = new Set(
    [...candidateKeys].map((key) => namespaceOf(key)),
  );
  const names = new Set(
    [input.hintName, input.candidate.canonicalName ?? '']
      .map(normalizeGeoName)
      .filter(Boolean),
  );
  const isCandidate = (member: CompetitorPoolMember) =>
    member.identityKeys.some((key) => candidateKeys.has(key));
  const candidateGrade = bestNameCorrespondence(input.hintName, [
    input.candidate.canonicalName ?? '',
    ...(input.candidate.nameAliasCandidates ?? []),
  ]);
  const answersToHint = (member: CompetitorPoolMember) =>
    names.has(normalizeGeoName(member.name)) ||
    member.declaresHintAlias === true ||
    (candidateGrade === 'OVERLAP' &&
      nameCorrespondence(input.hintName, member.name) !== 'NONE');

  let competitorCount = 0;
  let examined = false;
  for (const pool of input.pools) {
    const material = pool.members.filter(
      (member) =>
        answersToHint(member) &&
        evaluateStructuralCompatibility(
          input.expectedKind,
          member.structuralKind,
        ) === 'COMPATIBLE' &&
        !excludedBySourceContext(input.context, member) &&
        input.admits(member),
    );
    const others = material.filter((member) => !isCandidate(member));
    const holdsCandidate = others.length < material.length;
    // Within one pool every other record is a different identity of its
    // own namespace. When the pool does not hold the candidate and none of
    // its records shares a namespace with it, one of them may still be the
    // candidate under another key: only the rest are known competitors.
    const comparable =
      holdsCandidate ||
      others.some((member) =>
        member.identityKeys.some((key) =>
          candidateNamespaces.has(namespaceOf(key)),
        ),
      );
    competitorCount = Math.max(
      competitorCount,
      comparable ? others.length : Math.max(0, others.length - 1),
    );
    if (pool.coverage === 'COMPLETE' && holdsCandidate && others.length === 0) {
      examined = true;
    }
  }
  return {
    type: 'COMPETITOR_EXAMINATION',
    outcome:
      competitorCount > 0
        ? 'MATERIAL_COMPETITOR_KNOWN'
        : examined
          ? 'NO_MATERIAL_COMPETITOR'
          : 'NO_COMPETITOR_OBSERVED',
    examinedStrategies: uniqueStrategies(input.pools),
    competitorCount,
  };
}

function excludedBySourceContext(
  context: ComponentIdentityContext,
  member: CompetitorPoolMember,
): boolean {
  return (
    localityRelation(context, member) === 'OUTSIDE' ||
    kindCompatibility(context.physicalKind?.kind, member.structuralKind) ===
      'INCOMPATIBLE'
  );
}

function namespaceOf(identityKey: string): string {
  return identityKey.slice(0, identityKey.indexOf('/'));
}

function uniqueStrategies(
  pools: readonly CompetitorPool[],
): ResolutionStrategy[] {
  return [...new Set(pools.map((pool) => pool.strategy))];
}
