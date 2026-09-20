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

    // ADDRESS_MATCH is always VERIFIED (address either matches or it doesn't)
    if (this.evidenceOf(evidence, 'ADDRESS_MATCH'))
      return { status: 'VERIFIED' };

    // DECLARED_ALIAS_MATCH can VERIFY if SINGLE
    const alias = this.evidenceOf(evidence, 'DECLARED_ALIAS_MATCH');
    if (alias && alias.identityMultiplicity === 'SINGLE')
      return { status: 'VERIFIED' };

    // WIKIDATA_IDENTITY_MATCH with both hint and candidate matched
    const wikidataMatch = this.evidenceOf(evidence, 'WIKIDATA_IDENTITY_MATCH');
    if (wikidataMatch) {
      return wikidataMatch.hintMatched && wikidataMatch.candidateMatched
        ? { status: 'VERIFIED' }
        : { status: 'REJECTED' };
    }

    // Now check EXACT_NAME
    if (exactName) {
      if (exactName.identityMultiplicity === 'SINGLE')
        return { status: 'VERIFIED' };
      if (exactName.identityMultiplicity === 'MULTIPLE') {
        // EXACT_NAME MULTIPLE falls through to check other corroborating evidence
        // but if no other evidence VERIFIES, we return AMBIGUOUS
      }
      // UNKNOWN falls through
    }

    if (this.evidenceOf(evidence, 'WIKIDATA_UNAVAILABLE')) {
      return { status: 'INSUFFICIENT_EVIDENCE' };
    }

    // If we reach here, no VERIFIED evidence was found
    // Return AMBIGUOUS if any local evidence had MULTIPLE, else INSUFFICIENT_EVIDENCE
    const hasMultiple =
      exactName?.identityMultiplicity === 'MULTIPLE' ||
      alias?.identityMultiplicity === 'MULTIPLE';
    return hasMultiple
      ? { status: 'AMBIGUOUS' }
      : { status: 'INSUFFICIENT_EVIDENCE' };
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
