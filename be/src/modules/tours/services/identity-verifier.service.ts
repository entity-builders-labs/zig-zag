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
    if (wikidataMatch) {
      return wikidataMatch.hintMatched && wikidataMatch.candidateMatched
        ? { status: 'VERIFIED' }
        : { status: 'REJECTED' };
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
