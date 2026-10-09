import { NameCorrespondence } from '../interfaces/experience-resolution.interface';
import {
  hasSpecificNameOverlap,
  normalizeGeoName,
} from './nominatim-match.util';

/**
 * Verification-grade name correspondence. Candidate retrieval may match
 * permissively (`hasSpecificNameOverlap` drops tokens under four letters
 * and only asks that the hint's long tokens appear in the other name), and
 * that is what recall needs. As identity proof it is circular: "Don
 * Carlos" reduces to "carlos" and so "matches" every "Carlos ..." record.
 *
 * EQUIVALENT is bidirectional over every normalized token, short ones
 * included: each name holds all of the other's tokens. Anything weaker that
 * still clears the retrieval bar is OVERLAP, which IdentityVerifier never
 * accepts as proof (see `identityEvidenceRole`).
 */
export function nameCorrespondence(
  name: string,
  other: string,
): NameCorrespondence {
  const left = normalizeGeoName(name);
  const right = normalizeGeoName(other);
  if (!left || !right) return 'NONE';
  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const equivalent =
    [...leftTokens].every((token) => rightTokens.has(token)) &&
    [...rightTokens].every((token) => leftTokens.has(token));
  if (equivalent) return 'EQUIVALENT';
  return hasSpecificNameOverlap(left, right, { requireAllTokens: true })
    ? 'OVERLAP'
    : 'NONE';
}

const STRENGTH: Record<NameCorrespondence, number> = {
  NONE: 0,
  OVERLAP: 1,
  EQUIVALENT: 2,
};

/**
 * How a hint names a candidate record: the strongest correspondence of the
 * hint to the record's canonical name or any alias the record declares.
 * The one grade competitor examination and identity convergence read.
 */
export function hintCandidateCorrespondence(
  hintName: string,
  candidate: {
    canonicalName?: string | null;
    nameAliasCandidates?: readonly string[];
  },
): NameCorrespondence {
  return bestNameCorrespondence(hintName, [
    candidate.canonicalName ?? '',
    ...(candidate.nameAliasCandidates ?? []),
  ]);
}

/** The strongest correspondence of `name` to any of `others`. */
export function bestNameCorrespondence(
  name: string,
  others: readonly string[],
): NameCorrespondence {
  let best: NameCorrespondence = 'NONE';
  for (const other of others) {
    const correspondence = nameCorrespondence(name, other);
    if (STRENGTH[correspondence] > STRENGTH[best]) best = correspondence;
  }
  return best;
}
