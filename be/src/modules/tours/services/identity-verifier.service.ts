import {
  IdentityEvidence,
  IdentityVerdict,
  IdentityVerificationRule,
  ResolutionAttempt,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';
import { identityEvidenceRole } from '../utils/identity-evidence-role.policy';

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
 *     its strong identity (QID), or the source's address matches it. Two
 *     equally consistent members are AMBIGUOUS whatever the name says.
 *  4. A material competitor known from ANY pool examined for this hint
 *     (COMPETITOR_EXAMINATION) -> AMBIGUOUS. A name, an alias, convergence
 *     of any provenance or a Wikidata label confirms that a record matches
 *     the hint text; none of them decides which homonym the source meant.
 *  4b. A QID link (OWN_QID / OBSERVATION_QID) that corroborates both sides
 *     -> VERIFIED, now that no competitor is known. It is not
 *     discriminating: it may never skip rule 4.
 *  5. Convergence (two strategies on one strong identity) decides only
 *     over an examined competitor set (NO_MATERIAL_COMPETITOR). Over an
 *     unexamined one it confirms a record, nothing more.
 *  6. Name, address and alias evidence with its own multiplicity.
 *  7. Wikidata corroboration (NEARBY never decides a name collision, and
 *     a NEARBY non-match is NOT_CORROBORATED, never a contradiction).
 *  8. Missing evidence -> INSUFFICIENT_EVIDENCE / AMBIGUOUS.
 *
 * What each fact can do is `identityEvidenceRole`'s decision, not this
 * class's: no RETRIEVAL_ONLY fact (a lexical OVERLAP, the grade candidate
 * retrieval uses) ever decides VERIFIED. A candidate's own QID identifies
 * the candidate; only an EQUIVALENT hint-to-label correspondence lets it
 * stand for the source's meaning.
 *
 * Rules 5, 6 and the NEARBY confirmation in 7 rest on uniqueness, not on
 * a fact that singles the candidate out. They decide only when
 * GEOGRAPHIC_CORRESPONDENCE grounds the geography that uniqueness was
 * counted in (a bounded admission scope, the source's grounded locality,
 * or a verified source-named composition AREA). Absent or
 * ADMISSION_SCOPE_ONLY, they are not decisive (RW4-ID-CORRESPONDENCE-1).
 */
export class IdentityVerifier {
  /** The verdict only; see `decide` for the rule and decisive evidence. */
  verify(
    hint: { name: string },
    attempt: ResolutionAttempt,
  ): VerificationDecision {
    return { status: this.decide(hint, attempt).status };
  }

  /**
   * The verdict, the rule that produced it and the evidence that rule
   * read, so a trace can answer "why VERIFIED?" without replaying.
   */
  decide(_hint: { name: string }, attempt: ResolutionAttempt): IdentityVerdict {
    const evidence = attempt.evidence;
    const verdict = (
      status: VerificationDecision['status'],
      rule: IdentityVerificationRule,
      ...decisive: Array<IdentityEvidence | undefined>
    ): IdentityVerdict => ({
      status,
      rule,
      decisiveEvidence: decisive.filter(
        (item): item is IdentityEvidence => item !== undefined,
      ),
    });
    const exactName = this.evidenceOf(evidence, 'EXACT_NAME');
    const alias = this.evidenceOf(evidence, 'DECLARED_ALIAS_MATCH');

    // 1. An explicit identity contradiction precedes every positive rule.
    // Convergence, a unique name, an address or an alias each establish
    // that a record matches the hint text; none of them can outweigh the
    // source having identified the component as a different entity.
    if (this.evidenceOf(evidence, 'IDENTITY_CONTRADICTION')) {
      return verdict(
        'REJECTED',
        'IDENTITY_CONTRADICTION',
        this.evidenceOf(evidence, 'IDENTITY_CONTRADICTION'),
      );
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
        return verdict('AMBIGUOUS', 'STRUCTURED_ROUTE', structuredRoute);
      }
      if (structuredRoute.destinationCompatibility === 'COMPATIBLE') {
        return verdict('VERIFIED', 'STRUCTURED_ROUTE', structuredRoute);
      }
    }

    // 2b. Catalog reuse of a canonical ROUTE through a route retrieval
    // variant: same multiplicity semantics as EXACT_NAME.
    const routeVariant = this.evidenceOf(
      evidence,
      'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH',
    );
    if (routeVariant?.identityMultiplicity === 'SINGLE') {
      return verdict('VERIFIED', 'CATALOG_ROUTE_VARIANT', routeVariant);
    }
    if (routeVariant?.identityMultiplicity === 'MULTIPLE') {
      return verdict('AMBIGUOUS', 'CATALOG_ROUTE_VARIANT', routeVariant);
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
      return verdict('VERIFIED', 'CATALOG_VERIFIED_HINT', verifiedHint);
    }
    if (verifiedHint?.identityMultiplicity === 'MULTIPLE') {
      return verdict('AMBIGUOUS', 'CATALOG_VERIFIED_HINT', verifiedHint);
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
      return verdict('VERIFIED', 'CONTEXTUAL_CORRESPONDENCE', contextual);
    }
    if (contextual?.outcome === 'AMBIGUOUS') {
      return verdict('AMBIGUOUS', 'CONTEXTUAL_CORRESPONDENCE', contextual);
    }

    // 3b. The source declares this component's strong identity and the
    // candidate carries it: the mirror image of the QID contradiction.
    if (this.evidenceOf(evidence, 'SOURCE_DECLARED_IDENTITY_MATCH')) {
      return verdict(
        'VERIFIED',
        'SOURCE_DECLARED_IDENTITY',
        this.evidenceOf(evidence, 'SOURCE_DECLARED_IDENTITY_MATCH'),
      );
    }

    // 3c. The source's own address for the component matches the
    // candidate's: it singles out one branch of a same-name chain.
    if (this.evidenceOf(evidence, 'ADDRESS_MATCH')) {
      return verdict(
        'VERIFIED',
        'ADDRESS_MATCH',
        this.evidenceOf(evidence, 'ADDRESS_MATCH'),
      );
    }

    // 4. A material competitor is known for this hint, from whichever pool
    // exposed it (a Places circle seeing one member does not undo the
    // homonyms Nominatim returned). Nothing below is discriminating.
    const competitors = this.evidenceOf(evidence, 'COMPETITOR_EXAMINATION');
    if (competitors?.outcome === 'MATERIAL_COMPETITOR_KNOWN') {
      return verdict('AMBIGUOUS', 'MATERIAL_COMPETITOR_KNOWN', competitors);
    }

    // 4b. A QID the source declares (OBSERVATION_QID) or the candidate
    // record itself carries (OWN_QID), linked to the other side by an
    // EQUIVALENT name: a structural link to one Wikidata entity, so it
    // singles out the record that carries it among same-name records that
    // are not material competitors (P0.2: a park and a transit stop both
    // named "Plaza de Mayo", the park tagged with the item). It runs after
    // rule 4 because it says who a record is, not which homonym the source
    // meant. A link whose other side only OVERLAPs a label is
    // RETRIEVAL_ONLY: the C3 "Don Carlos" -> tomb of Carlos Pellegrini
    // chain (fuzzy retrieval, then the candidate's own QID, then a fuzzy
    // hint-to-label match) proves nothing.
    const wikidataMatch = this.evidenceOf(evidence, 'WIKIDATA_IDENTITY_MATCH');
    if (
      wikidataMatch &&
      wikidataMatch.source !== 'NEARBY' &&
      identityEvidenceRole(wikidataMatch) === 'CORROBORATING'
    ) {
      return verdict('VERIFIED', 'QID_LINK', wikidataMatch, competitors);
    }

    // Uniqueness identifies the source's place only inside a grounded
    // geography. Country-wide uniqueness is dataset-relative: real data
    // holds a lone wrong homonym whenever the true place is missing from
    // the dataset, and nothing in a name count tells the two apart.
    const correspondence = this.evidenceOf(
      evidence,
      'GEOGRAPHIC_CORRESPONDENCE',
    );
    const uniquenessIsGrounded =
      correspondence !== undefined &&
      correspondence.basis !== 'ADMISSION_SCOPE_ONLY';

    // 5. IDENTITY_CONVERGENCE: two acquisition strategies reached the same
    // strong identity (pure ID equality). Whatever the upstream relation,
    // it establishes that the record matches the hint, not that no other
    // record does: it decides only when the competitor set was examined by
    // a complete pool that holds this candidate and no material competitor.
    // Absent or partial examination is UNKNOWN uniqueness, never "no
    // collision" -- it falls through to the remaining evidence.
    if (
      uniquenessIsGrounded &&
      this.evidenceOf(evidence, 'IDENTITY_CONVERGENCE') &&
      competitors?.outcome === 'NO_MATERIAL_COMPETITOR'
    ) {
      return verdict(
        'VERIFIED',
        'GROUNDED_CONVERGENCE',
        this.evidenceOf(evidence, 'IDENTITY_CONVERGENCE'),
        competitors,
        correspondence,
      );
    }

    // 6. EXACT_NAME + SINGLE -> VERIFIED. SINGLE is the producer's claim
    // that its pool examined the admission scope (a pool that cannot cover
    // it reports UNKNOWN for a lone member).
    if (
      uniquenessIsGrounded &&
      exactName &&
      exactName.identityMultiplicity === 'SINGLE'
    ) {
      return verdict(
        'VERIFIED',
        'GROUNDED_UNIQUE_EXACT_NAME',
        exactName,
        correspondence,
      );
    }

    // 6b. DECLARED_ALIAS_MATCH + SINGLE -> VERIFIED, for an alias that
    // names the hint EQUIVALENTLY. An OVERLAP alias is RETRIEVAL_ONLY.
    if (
      uniquenessIsGrounded &&
      alias &&
      alias.identityMultiplicity === 'SINGLE' &&
      identityEvidenceRole(alias) === 'CORROBORATING'
    ) {
      return verdict(
        'VERIFIED',
        'GROUNDED_UNIQUE_ALIAS',
        alias,
        correspondence,
      );
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
      // OBSERVATION_QID already decided at rule 4b.
      const role = identityEvidenceRole(wikidataMatch);
      const corroborated = role === 'CORROBORATING';
      const disambiguates =
        !namePoolHasCollision || wikidataMatch.source !== 'NEARBY';
      // A NEARBY item confirms a unique record; uniqueness itself must be
      // grounded (rules 5-6). Structural QID links decided at rule 4b.
      if (corroborated && disambiguates && uniquenessIsGrounded) {
        return verdict(
          'VERIFIED',
          'WIKIDATA_CORROBORATION',
          wikidataMatch,
          correspondence,
        );
      }
      // A non-corroborating (or non-disambiguating) match over a real name
      // collision only failed to single out one member: AMBIGUOUS, not
      // REJECTED, which would imply the identity was disproven.
      if (namePoolHasCollision) {
        return verdict(
          'AMBIGUOUS',
          'NAME_COLLISION',
          wikidataMatch,
          exactName,
          alias,
        );
      }
      // Any NEARBY result other than one item naming both is
      // NOT_CORROBORATED, never CONTRADICTED (2026-09-22 amendment §6). Its
      // correspondences are text matches of labels found around the
      // candidate's own point: a label matching only the hint (El Zanjón:
      // the candidate's "(historic ruins)" suffix defeats the label match)
      // or only the candidate establishes no incompatible identity, so the
      // decision falls through to the remaining evidence. A positive
      // contradiction is a typed IDENTITY_CONTRADICTION (rule 1). An OWN_QID
      // / OBSERVATION_QID item that does not name the other side at all is
      // CONTRADICTORY and stays REJECTED; one that only OVERLAPs it is
      // RETRIEVAL_ONLY and decides nothing.
      if (role === 'CONTRADICTORY') {
        return verdict('REJECTED', 'QID_LINK_MISMATCH', wikidataMatch);
      }
    }

    // 8. Fallback based on multiplicity
    if (this.evidenceOf(evidence, 'WIKIDATA_UNAVAILABLE')) {
      return verdict(
        'INSUFFICIENT_EVIDENCE',
        'WIKIDATA_UNAVAILABLE',
        this.evidenceOf(evidence, 'WIKIDATA_UNAVAILABLE'),
      );
    }

    // If we reach here, no VERIFIED evidence was found
    // EXACT_NAME MULTIPLE -> AMBIGUOUS
    if (exactName && exactName.identityMultiplicity === 'MULTIPLE') {
      return verdict('AMBIGUOUS', 'NAME_COLLISION', exactName);
    }
    // DECLARED_ALIAS_MATCH MULTIPLE -> AMBIGUOUS
    if (alias && alias.identityMultiplicity === 'MULTIPLE') {
      return verdict('AMBIGUOUS', 'NAME_COLLISION', alias);
    }
    // EXACT_NAME UNKNOWN -> INSUFFICIENT_EVIDENCE
    if (exactName && exactName.identityMultiplicity === 'UNKNOWN') {
      return verdict(
        'INSUFFICIENT_EVIDENCE',
        'NAME_UNIQUENESS_UNKNOWN',
        exactName,
      );
    }
    // DECLARED_ALIAS_MATCH UNKNOWN -> INSUFFICIENT_EVIDENCE
    if (alias && alias.identityMultiplicity === 'UNKNOWN') {
      return verdict('INSUFFICIENT_EVIDENCE', 'NAME_UNIQUENESS_UNKNOWN', alias);
    }
    // No local name evidence at all
    return verdict('INSUFFICIENT_EVIDENCE', 'NO_DECISIVE_EVIDENCE');
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
