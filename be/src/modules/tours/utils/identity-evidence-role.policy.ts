import { IdentityEvidence } from '../interfaces/experience-resolution.interface';

/**
 * What one identity fact can do in IdentityVerifier. This is the single
 * authority for that question; the verifier reads it instead of judging
 * evidence strength inline.
 *  - DISCRIMINATING: singles this candidate out among homonyms on its own
 *    (a source-declared strong identity, the source's own address, a
 *    grounded locality that distinguishes it, a structural route, exact
 *    reuse of a previously verified identity).
 *  - CORROBORATING: establishes that this record answers to the hint, but
 *    not that no other record does. It decides only where no material
 *    competitor is known, and (for name uniqueness) only inside a grounded
 *    geography.
 *  - RETRIEVAL_ONLY: a retrieval-grade lexical match (OVERLAP). It may
 *    explain why a record was considered; it never proves identity.
 *  - CONTRADICTORY: the record is identified as something else.
 *  - QUALIFYING: says where or over what set the other facts hold
 *    (competitors, grounded geography, provenance, availability). Never
 *    decisive alone.
 */
export type IdentityEvidenceRole =
  | 'DISCRIMINATING'
  | 'CORROBORATING'
  | 'RETRIEVAL_ONLY'
  | 'CONTRADICTORY'
  | 'QUALIFYING';

export function identityEvidenceRole(
  evidence: IdentityEvidence,
): IdentityEvidenceRole {
  switch (evidence.type) {
    case 'IDENTITY_CONTRADICTION':
      return 'CONTRADICTORY';
    case 'SOURCE_DECLARED_IDENTITY_MATCH':
    case 'ADDRESS_MATCH':
      return 'DISCRIMINATING';
    case 'CONTEXTUAL_CORRESPONDENCE':
      return evidence.outcome === 'DISTINGUISHED'
        ? 'DISCRIMINATING'
        : 'QUALIFYING';
    case 'STRUCTURED_ROUTE_RESOLUTION':
      return evidence.ambiguity !== 'MULTIPLE_CLUSTERS' &&
        evidence.destinationCompatibility === 'COMPATIBLE'
        ? 'DISCRIMINATING'
        : 'QUALIFYING';
    case 'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH':
    case 'CATALOG_VERIFIED_HINT_MATCH':
      return evidence.identityMultiplicity === 'SINGLE'
        ? 'DISCRIMINATING'
        : 'QUALIFYING';
    case 'EXACT_NAME':
    case 'IDENTITY_CONVERGENCE':
      return 'CORROBORATING';
    case 'DECLARED_ALIAS_MATCH':
      return evidence.correspondence === 'EQUIVALENT'
        ? 'CORROBORATING'
        : 'RETRIEVAL_ONLY';
    case 'WIKIDATA_IDENTITY_MATCH':
      return wikidataLinkRole(evidence);
    case 'WIKIDATA_UNAVAILABLE':
    case 'CONVERGENCE_PROVENANCE':
    case 'COMPETITOR_EXAMINATION':
    case 'GEOGRAPHIC_CORRESPONDENCE':
      return 'QUALIFYING';
    default: {
      const unhandled: never = evidence;
      throw new Error(
        `Unclassified identity evidence: ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * A Wikidata link corroborates only when each side either carries the item
 * or names it EQUIVALENTLY. A side that merely OVERLAPs a label is
 * retrieval-grade: the candidate's own QID identifies the candidate, and a
 * fuzzy hint-to-label match cannot bootstrap that into the source's
 * meaning. A structural link (OWN_QID / OBSERVATION_QID) to an item that
 * does not name the other side at all is a contradiction; a NEARBY item
 * that does not is merely NOT_CORROBORATED.
 */
function wikidataLinkRole(
  evidence: Extract<IdentityEvidence, { type: 'WIKIDATA_IDENTITY_MATCH' }>,
): IdentityEvidenceRole {
  const sides = [evidence.hintCorrespondence, evidence.candidateCorrespondence];
  if (sides.includes('NONE')) {
    return evidence.source === 'NEARBY' ? 'QUALIFYING' : 'CONTRADICTORY';
  }
  if (sides.includes('OVERLAP')) return 'RETRIEVAL_ONLY';
  return 'CORROBORATING';
}
