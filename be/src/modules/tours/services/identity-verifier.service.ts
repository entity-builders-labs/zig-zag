import {
  IdentityEvidence,
  ResolutionAttempt,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';

/**
 * The single authority for interpreting normalized identity facts. It never
 * acquires or ranks candidates and never persists them.
 *
 * Decision order (no score, no threshold, no provider vote):
 *  1. Explicit contradiction (source vs candidate QID, locality or
 *     physical kind) -> REJECTED. Nothing positive outweighs it.
 *  2. Structural identity: a single route cluster, a catalog route variant
 *     or verified hint memory, each with its own multiplicity.
 *  3. Discriminating correspondence -- a source-grounded fact that singles
 *     out this candidate among homonyms: the component's locality (and
 *     kind) DISTINGUISHES it in a complete comparison, the source declares
 *     its strong identity (QID), the source's address matches it, or a
 *     source-declared or candidate-declared QID corroborates it. Two
 *     equally consistent members are AMBIGUOUS whatever the name says.
 *  4. A material competitor known from ANY pool examined for this hint
 *     (COMPETITOR_EXAMINATION) -> AMBIGUOUS. A name, an alias, convergence
 *     of any provenance or a Wikidata label confirms that a record matches
 *     the hint text; none of them decides which homonym the source meant.
 *  5. Convergence (two strategies on one strong identity) decides only
 *     over an examined competitor set (NO_MATERIAL_COMPETITOR). Over an
 *     unexamined one it confirms a record, nothing more.
 *  6. Name, address and alias evidence with its own multiplicity.
 *  7. Wikidata corroboration (NEARBY never decides a name collision, and
 *     a NEARBY non-match is NOT_CORROBORATED, never a contradiction).
 *  8. Missing evidence -> INSUFFICIENT_EVIDENCE / AMBIGUOUS.
 */
export class IdentityVerifier {
  verify(
    hint: { name: string },
    attempt: ResolutionAttempt,
  ): VerificationDecision {
    const evidence = attempt.evidence;
    const exactName = this.evidenceOf(evidence, 'EXACT_NAME');
    const alias = this.evidenceOf(evidence, 'DECLARED_ALIAS_MATCH');

    // 1. An explicit identity contradiction precedes every positive rule.
    // Convergence, a unique name, an address or an alias each establish
    // that a record matches the hint text; none of them can outweigh the
    // source having identified the component as a different entity.
    if (this.evidenceOf(evidence, 'IDENTITY_CONTRADICTION')) {
      return { status: 'REJECTED' };
    }

    // 2a. STRUCTURED_ROUTE_RESOLUTION -> VERIFIED only for exactly one
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

    // 2b. Catalog reuse of a canonical ROUTE through a route retrieval
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

    // 2c. Catalog reuse through verified hint memory: this exact hint key
    // was remembered on the canonical GeoEntity only after an earlier
    // resolution of it was VERIFIED here. Same multiplicity semantics as
    // EXACT_NAME -- a key shared by several in-scope GeoEntities is
    // AMBIGUOUS, never a winner. A stated locality the remembered entity
    // lies outside is a contradiction (rule 1), never reused.
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

    // 3a. Contextual correspondence. DISTINGUISHED: the source's
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

    // 3b. The source declares this component's strong identity and the
    // candidate carries it: the mirror image of the QID contradiction.
    if (this.evidenceOf(evidence, 'SOURCE_DECLARED_IDENTITY_MATCH')) {
      return { status: 'VERIFIED' };
    }

    // 3c. The source's own address for the component matches the
    // candidate's: it singles out one branch of a same-name chain.
    if (this.evidenceOf(evidence, 'ADDRESS_MATCH')) {
      return { status: 'VERIFIED' };
    }

    // 3d. A QID the source declares (OBSERVATION_QID) or the candidate
    // record itself declares (OWN_QID) whose labels corroborate both the
    // hint and the candidate: a structural link to one Wikidata entity, not
    // a proximity search, so it singles out the record that carries it
    // (P0.2: the one of two exact-name OSM objects tagged with the item).
    // A NEARBY match is never discriminating (rule 7).
    const wikidataMatch = this.evidenceOf(evidence, 'WIKIDATA_IDENTITY_MATCH');
    if (
      wikidataMatch &&
      wikidataMatch.source !== 'NEARBY' &&
      wikidataMatch.hintMatched &&
      wikidataMatch.candidateMatched
    ) {
      return { status: 'VERIFIED' };
    }

    // 4. A material competitor is known for this hint, from whichever pool
    // exposed it (a Places circle seeing one member does not undo the
    // homonyms Nominatim returned). Nothing below is discriminating.
    const competitors = this.evidenceOf(evidence, 'COMPETITOR_EXAMINATION');
    if (competitors?.outcome === 'MATERIAL_COMPETITOR_KNOWN') {
      return { status: 'AMBIGUOUS' };
    }

    // 5. IDENTITY_CONVERGENCE: two acquisition strategies reached the same
    // strong identity (pure ID equality). Whatever the upstream relation,
    // it establishes that the record matches the hint, not that no other
    // record does: it decides only when the competitor set was examined by
    // a complete pool that holds this candidate and no material competitor.
    // Absent or partial examination is UNKNOWN uniqueness, never "no
    // collision" -- it falls through to the remaining evidence.
    if (
      this.evidenceOf(evidence, 'IDENTITY_CONVERGENCE') &&
      competitors?.outcome === 'NO_MATERIAL_COMPETITOR'
    ) {
      return { status: 'VERIFIED' };
    }

    // 6. EXACT_NAME + SINGLE -> VERIFIED. SINGLE is the producer's claim
    // that its pool examined the admission scope (a pool that cannot cover
    // it reports UNKNOWN for a lone member).
    if (exactName && exactName.identityMultiplicity === 'SINGLE') {
      return { status: 'VERIFIED' };
    }

    // 6b. DECLARED_ALIAS_MATCH + SINGLE -> VERIFIED
    if (alias && alias.identityMultiplicity === 'SINGLE') {
      return { status: 'VERIFIED' };
    }

    // 7. WIKIDATA_IDENTITY_MATCH
    const namePoolHasCollision =
      exactName?.identityMultiplicity === 'MULTIPLE' ||
      alias?.identityMultiplicity === 'MULTIPLE';
    if (wikidataMatch) {
      // A NEARBY search is centered on the selected candidate's own point
      // and compares names only, so every same-named pool member that has
      // a Wikidata item corroborates itself equally. It can confirm a
      // unique candidate; it never decides WHICH member of a real name
      // collision the source meant (live: "Ojo de Agua" -> a Cordoba hamlet
      // 383 km from the source's Lujan de Cuyo). A corroborating OWN_QID /
      // OBSERVATION_QID already decided at rule 3d.
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
      // Any NEARBY result other than one item matching both names is
      // NOT_CORROBORATED, never CONTRADICTED (2026-09-22 amendment §6). Its
      // booleans are text matches of labels found around the candidate's
      // own point: a label matching only the hint (El Zanjón: the
      // candidate's "(historic ruins)" suffix defeats the label match) or
      // only the candidate establishes no incompatible identity, so the
      // decision falls through to the remaining evidence. A positive
      // contradiction is a typed IDENTITY_CONTRADICTION (rule 1). A failing
      // OWN_QID / OBSERVATION_QID match is a structural link to one item
      // that does not name both sides, and stays REJECTED.
      if (wikidataMatch.source !== 'NEARBY') {
        return { status: 'REJECTED' };
      }
    }

    // 8. Fallback based on multiplicity
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
