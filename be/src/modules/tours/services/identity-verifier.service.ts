import {
  IdentityEvidence,
  ResolutionAttempt,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';

/**
 * The single authority for interpreting normalized identity facts. It never
 * acquires or ranks candidates and never persists them.
 *
 * Decision order (no score, no threshold):
 *  1. Explicit contradiction (source vs candidate QID, locality or
 *     physical kind) -> REJECTED. Nothing positive outweighs it.
 *  2. Structural identity: a single route cluster, catalog route variant
 *     or verified hint memory (each with its own multiplicity), or the
 *     same identity reached through INDEPENDENT upstreams.
 *  3. Contextual correspondence: the source's component-specific locality
 *     (and kind) singles out exactly one member of a fully examined pool
 *     -> VERIFIED without country-wide name uniqueness; two consistent
 *     members -> AMBIGUOUS whatever the name evidence says.
 *  4. Name, address and alias evidence with its own multiplicity.
 *  5. Wikidata corroboration (NEARBY never decides a name collision).
 *  6. Missing evidence -> INSUFFICIENT_EVIDENCE / AMBIGUOUS.
 * Two acquisitions repeating one upstream record (Nominatim and Geoapify
 * on one OSM node) are one fact, not convergence.
 */
export class IdentityVerifier {
  verify(
    hint: { name: string },
    attempt: ResolutionAttempt,
  ): VerificationDecision {
    const evidence = attempt.evidence;
    const exactName = this.evidenceOf(evidence, 'EXACT_NAME');
    const alias = this.evidenceOf(evidence, 'DECLARED_ALIAS_MATCH');

    // -1. An explicit identity contradiction precedes every positive rule.
    // Convergence, a unique name, an address or an alias each establish
    // that a record matches the hint text; none of them can outweigh the
    // source having identified the component as a different entity.
    if (this.evidenceOf(evidence, 'IDENTITY_CONTRADICTION')) {
      return { status: 'REJECTED' };
    }

    // 0. IDENTITY_CONVERGENCE -> VERIFIED only across INDEPENDENT
    // upstreams: two acquisitions over different datasets landing on the
    // same strong identity. Two indexes of one upstream record (Nominatim
    // and Geoapify on one OSM node, both chosen by name and proximity) are
    // one fact and fall through to the remaining evidence.
    const convergence = this.evidenceOf(evidence, 'IDENTITY_CONVERGENCE');
    if (convergence?.upstream === 'INDEPENDENT_UPSTREAMS') {
      return { status: 'VERIFIED' };
    }

    // 0b. STRUCTURED_ROUTE_RESOLUTION -> VERIFIED only for exactly one
    // destination-compatible structural cluster of real OSM ways; competing
    // clusters are AMBIGUOUS, never a winner.
    const structuredRoute = this.evidenceOf(
      evidence,
      'STRUCTURED_ROUTE_RESOLUTION',
    );
    if (structuredRoute) {
      if (structuredRoute.ambiguity === 'MULTIPLE_CLUSTERS') {
        return { status: 'AMBIGUOUS' };
      }
      if (structuredRoute.destinationCompatibility === 'COMPATIBLE') {
        return { status: 'VERIFIED' };
      }
    }

    // 0c. Catalog reuse of a canonical ROUTE through a route retrieval
    // variant: same multiplicity semantics as EXACT_NAME.
    const routeVariant = this.evidenceOf(
      evidence,
      'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH',
    );
    if (routeVariant?.identityMultiplicity === 'SINGLE') {
      return { status: 'VERIFIED' };
    }
    if (routeVariant?.identityMultiplicity === 'MULTIPLE') {
      return { status: 'AMBIGUOUS' };
    }

    // 0d. Catalog reuse through verified hint memory: this exact hint key
    // was remembered on the canonical GeoEntity only after an earlier
    // resolution of it was VERIFIED here. Same multiplicity semantics as
    // EXACT_NAME -- a key shared by several in-scope GeoEntities is
    // AMBIGUOUS, never a winner.
    const verifiedHint = this.evidenceOf(
      evidence,
      'CATALOG_VERIFIED_HINT_MATCH',
    );
    if (verifiedHint?.identityMultiplicity === 'SINGLE') {
      return { status: 'VERIFIED' };
    }
    if (verifiedHint?.identityMultiplicity === 'MULTIPLE') {
      return { status: 'AMBIGUOUS' };
    }

    // 0e. Contextual correspondence. DISTINGUISHED: the source's
    // component-specific locality (and stated kind) is consistent with
    // exactly this member of a same-name pool examined without truncation
    // -- discriminating, so country-wide name uniqueness is not required.
    // AMBIGUOUS: another known member is equally consistent, which no
    // name-uniqueness claim can override. Other outcomes are not
    // discriminating and leave the decision to the remaining evidence.
    const contextual = this.evidenceOf(evidence, 'CONTEXTUAL_CORRESPONDENCE');
    if (contextual?.outcome === 'DISTINGUISHED') {
      return { status: 'VERIFIED' };
    }
    if (contextual?.outcome === 'AMBIGUOUS') {
      return { status: 'AMBIGUOUS' };
    }

    // 1. EXACT_NAME + SINGLE -> VERIFIED immediately
    if (exactName && exactName.identityMultiplicity === 'SINGLE') {
      return { status: 'VERIFIED' };
    }

    // 2. ADDRESS_MATCH -> VERIFIED
    if (this.evidenceOf(evidence, 'ADDRESS_MATCH')) {
      return { status: 'VERIFIED' };
    }

    // 3. DECLARED_ALIAS_MATCH + SINGLE -> VERIFIED
    if (alias && alias.identityMultiplicity === 'SINGLE') {
      return { status: 'VERIFIED' };
    }

    // 4. WIKIDATA_IDENTITY_MATCH
    const wikidataMatch = this.evidenceOf(evidence, 'WIKIDATA_IDENTITY_MATCH');
    const namePoolHasCollision =
      exactName?.identityMultiplicity === 'MULTIPLE' ||
      alias?.identityMultiplicity === 'MULTIPLE';
    if (wikidataMatch) {
      // A NEARBY search is centered on the selected candidate's own point
      // and compares names only, so every same-named pool member that has
      // a Wikidata item corroborates itself equally. It can confirm a
      // unique candidate; it never decides WHICH member of a real name
      // collision the source meant (live: "Ojo de Agua" -> a Cordoba hamlet
      // 383 km from the source's Lujan de Cuyo). A QID the candidate record
      // itself declares (OWN_QID) or the source declares (OBSERVATION_QID)
      // is a structural link, not a proximity search, and keeps its rule.
      const corroborated =
        wikidataMatch.hintMatched && wikidataMatch.candidateMatched;
      const disambiguates =
        !namePoolHasCollision || wikidataMatch.source !== 'NEARBY';
      if (corroborated && disambiguates) {
        return { status: 'VERIFIED' };
      }
      // A non-corroborating (or non-disambiguating) match over a real name
      // collision only failed to single out one member: AMBIGUOUS, not
      // REJECTED, which would imply the identity was disproven.
      if (namePoolHasCollision) {
        return { status: 'AMBIGUOUS' };
      }
      // NEARBY matching neither name only means no Wikidata item was found
      // there: NOT_CORROBORATED, never CONTRADICTED (2026-09-22 amendment
      // §6). Fall through to the multiplicity fallback below. An item that
      // matches only one of the two names, or a candidate's own/observed
      // QID that fails to match, is positive evidence of another identity.
      const nothingFoundNearby =
        wikidataMatch.source === 'NEARBY' &&
        !wikidataMatch.hintMatched &&
        !wikidataMatch.candidateMatched;
      if (!nothingFoundNearby) {
        return { status: 'REJECTED' };
      }
    }

    // 5. Fallback based on multiplicity
    if (this.evidenceOf(evidence, 'WIKIDATA_UNAVAILABLE')) {
      return { status: 'INSUFFICIENT_EVIDENCE' };
    }

    // If we reach here, no VERIFIED evidence was found
    // EXACT_NAME MULTIPLE -> AMBIGUOUS
    if (exactName && exactName.identityMultiplicity === 'MULTIPLE') {
      return { status: 'AMBIGUOUS' };
    }
    // DECLARED_ALIAS_MATCH MULTIPLE -> AMBIGUOUS
    if (alias && alias.identityMultiplicity === 'MULTIPLE') {
      return { status: 'AMBIGUOUS' };
    }
    // EXACT_NAME UNKNOWN -> INSUFFICIENT_EVIDENCE
    if (exactName && exactName.identityMultiplicity === 'UNKNOWN') {
      return { status: 'INSUFFICIENT_EVIDENCE' };
    }
    // DECLARED_ALIAS_MATCH UNKNOWN -> INSUFFICIENT_EVIDENCE
    if (alias && alias.identityMultiplicity === 'UNKNOWN') {
      return { status: 'INSUFFICIENT_EVIDENCE' };
    }
    // No local name evidence at all
    return { status: 'INSUFFICIENT_EVIDENCE' };
  }

  private evidenceOf<T extends IdentityEvidence['type']>(
    evidence: IdentityEvidence[],
    type: T,
  ): Extract<IdentityEvidence, { type: T }> | undefined {
    return evidence.find(
      (item): item is Extract<IdentityEvidence, { type: T }> =>
        item.type === type,
    );
  }
}
