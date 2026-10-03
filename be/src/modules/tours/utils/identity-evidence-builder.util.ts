import {
  EntityCandidate,
  IdentityEvidence,
} from '../interfaces/experience-resolution.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
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
  hint: { name: string; evidenceKeys?: string[] },
  candidate: EntityCandidate,
  observations: SourceObservation[] = [],
): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];

  // The QID the source declares for this component against the candidate
  // record's own: two identifiers are two entities (a contradiction), one
  // shared identifier is discriminating correspondence among homonyms.
  const sourceQid = sourceDeclaredWikidataQid(hint, observations);
  const candidateQid = candidate.wikidataQid;
  if (sourceQid && candidateQid) {
    if (sourceQid.toUpperCase() !== candidateQid.toUpperCase()) {
      evidence.push({
        type: 'IDENTITY_CONTRADICTION',
        fact: 'WIKIDATA_QID',
        sourceQid,
        candidateQid,
      });
    } else {
      evidence.push({
        type: 'SOURCE_DECLARED_IDENTITY_MATCH',
        identity: { provider: 'wikidata', externalId: candidateQid },
      });
    }
  }
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

/**
 * The Wikidata QID the source itself declares for this hint: the typed
 * `canonicalIdentity` of the first observation the hint cites that carries
 * one (e.g. a Wikivoyage listing's own `wikidata=`). Shared by local
 * contradiction detection and Wikidata corroboration so both read the same
 * source fact.
 */
export function sourceDeclaredWikidataQid(
  hint: { evidenceKeys?: string[] },
  observations: SourceObservation[],
): string | undefined {
  for (const key of hint.evidenceKeys ?? []) {
    const qid = observations.find((item) => item.evidenceKey === key)
      ?.canonicalIdentity?.wikidataQid;
    if (qid) return qid;
  }
  return undefined;
}

/**
 * Whether two acquisitions that reached one strong identity read
 * independent upstream datasets. Shared when any upstream is common (two
 * indexes of one OSM node); undetermined when either side's upstream is not
 * known -- never assumed independent.
 */
export function upstreamRelation(
  prior: readonly string[] | undefined,
  current: readonly string[] | undefined,
): 'SHARED_UPSTREAM' | 'INDEPENDENT_UPSTREAMS' | 'UNDETERMINED_UPSTREAM' {
  if (!prior?.length || !current?.length) return 'UNDETERMINED_UPSTREAM';
  return prior.some((dataset) => current.includes(dataset))
    ? 'SHARED_UPSTREAM'
    : 'INDEPENDENT_UPSTREAMS';
}
