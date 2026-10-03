import {
  IdentityEvidence,
  ResolutionAttempt,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';

/**
 * The single authority for interpreting normalized identity facts. It never
 * acquires or ranks candidates and never persists them.
 */
export class IdentityVerifier {
  verify(
    hint: { name: string },
    attempt: ResolutionAttempt,
  ): VerificationDecision {
    const evidence = attempt.evidence;
    const exactName = this.evidenceOf(evidence, 'EXACT_NAME');
    const alias = this.evidenceOf(evidence, 'DECLARED_ALIAS_MATCH');

    // 0. IDENTITY_CONVERGENCE -> VERIFIED immediately. A different,
    // structurally independent acquisition strategy already found this
    // exact same (provider, externalId) for this hint -- pure ID equality
    // across two separate lookup mechanisms, never a name/string
    // comparison and never a vote among competing candidates.
    if (this.evidenceOf(evidence, 'IDENTITY_CONVERGENCE')) {
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
