import {
  EntityCandidate,
  IdentityEvidence,
} from '../interfaces/experience-resolution.interface';
import {
  normalizeGeoName,
  hasSpecificNameOverlap,
} from './nominatim-match.util';

/**
 * Pure, provider-neutral, no-network helper that builds the local identity
 * evidence factors for a transient EntityCandidate. Used by both
 * ExperienceProposalResolverService and AreaRouteAnchorResolverService so
 * the same evidence-construction logic is never duplicated.
 *
 * This only produces local (non-network) evidence. External corroboration
 * (Wikidata identity match) is still collected separately by
 * IdentityEvidenceCollector.
 */
export function buildLocalIdentityEvidence(
  hint: { name: string },
  candidate: EntityCandidate,
): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];
  const nameMultiplicity = candidate.nameEvidenceMultiplicity;

  if (
    normalizeGeoName(candidate.canonicalName ?? '') ===
    normalizeGeoName(hint.name)
  ) {
    evidence.push({
      type: 'EXACT_NAME',
      identityMultiplicity: nameMultiplicity.exactName,
    });
  }

  if (candidate.addressConfirmed) {
    evidence.push({ type: 'ADDRESS_MATCH' });
  }

  // DECLARED_ALIAS_MATCH: aliases come from the specific candidate's own
  // OSM tags (name:xx, alt_name, wikipedia). If the candidate has at least
  // one matching alias, that is a direct declaration by the same real record
  // -- not a pool-level ambiguity. Use the candidate's declaredAlias multiplicity.
  const hasMatchingAlias = (candidate.nameAliasCandidates ?? []).some((alias) =>
    hasSpecificNameOverlap(
      normalizeGeoName(hint.name),
      normalizeGeoName(alias),
      { requireAllTokens: true },
    ),
  );
  if (hasMatchingAlias) {
    evidence.push({
      type: 'DECLARED_ALIAS_MATCH',
      identityMultiplicity: nameMultiplicity.declaredAlias,
    });
  }

  return evidence;
}
