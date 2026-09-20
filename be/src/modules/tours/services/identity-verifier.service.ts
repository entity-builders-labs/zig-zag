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
    if (exactName && !exactName.ambiguous) return { status: 'VERIFIED' };

    if (this.evidenceOf(evidence, 'ADDRESS_MATCH'))
      return { status: 'VERIFIED' };

    const alias = this.evidenceOf(evidence, 'DECLARED_ALIAS_MATCH');
    if (alias && !alias.ambiguous) return { status: 'VERIFIED' };

    const wikidataMatch = this.evidenceOf(evidence, 'WIKIDATA_IDENTITY_MATCH');
    if (wikidataMatch) {
      return wikidataMatch.hintMatched && wikidataMatch.candidateMatched
        ? { status: 'VERIFIED' }
        : { status: 'REJECTED' };
    }

    if (this.evidenceOf(evidence, 'WIKIDATA_UNAVAILABLE')) {
      return { status: 'INSUFFICIENT_EVIDENCE' };
    }

    return exactName?.ambiguous || alias?.ambiguous
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
