import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';
import {
  normalizeGeoName,
  hasSpecificNameOverlap,
} from '../utils/nominatim-match.util';
import {
  IdentityEvidence,
  ResolutionAttempt,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';

const CONFIRMATION_RADIUS_METERS = 200;

/**
 * The single authority for interpreting normalized identity facts. It never
 * acquires or ranks candidates and never persists them.
 */
export class IdentityVerifier {
  constructor(private readonly wikidata?: IWikidataApiService) {}

  async verify(
    hint: { name: string },
    attempt: ResolutionAttempt,
  ): Promise<VerificationDecision> {
    const evidence = attempt.evidence;
    const exactName = this.evidenceOf(evidence, 'EXACT_NAME');
    if (exactName && !exactName.ambiguous) return { status: 'VERIFIED' };

    if (this.evidenceOf(evidence, 'ADDRESS_MATCH'))
      return { status: 'VERIFIED' };

    const alias = this.evidenceOf(evidence, 'DECLARED_ALIAS_MATCH');
    if (alias && !alias.ambiguous) return { status: 'VERIFIED' };

    if (!this.wikidata) return { status: 'INSUFFICIENT_EVIDENCE' };

    const ownQid = this.evidenceOf(evidence, 'OWN_WIKIDATA_QID');
    if (ownQid) {
      const result = await this.confirmOwnQid(ownQid.qid, hint.name);
      if (result === true) return { status: 'VERIFIED' };
      if (result === false) return { status: 'REJECTED' };
    } else {
      const observationQid = this.evidenceOf(
        evidence,
        'OBSERVATION_WIKIDATA_QID',
      );
      if (observationQid) {
        const result = await this.confirmObservationQid(
          observationQid.qid,
          hint.name,
          attempt.candidate.canonicalName ?? '',
        );
        if (result === true) return { status: 'VERIFIED' };
        if (result === false) return { status: 'REJECTED' };
      }
    }

    const coordinates = this.evidenceOf(evidence, 'CANDIDATE_COORDINATES');
    if (!coordinates) {
      return exactName?.ambiguous || alias?.ambiguous
        ? { status: 'AMBIGUOUS' }
        : { status: 'INSUFFICIENT_EVIDENCE' };
    }

    try {
      const nearby = await this.wikidata.findNearbyPlaces(
        coordinates.latitude,
        coordinates.longitude,
        CONFIRMATION_RADIUS_METERS,
      );
      const needle = normalizeGeoName(hint.name);
      const matchedName = normalizeGeoName(
        attempt.candidate.canonicalName ?? '',
      );
      const confirmed = nearby.some(({ label }) => {
        const normalizedLabel = normalizeGeoName(label);
        return (
          hasSpecificNameOverlap(needle, normalizedLabel, {
            requireAllTokens: true,
          }) && hasSpecificNameOverlap(matchedName, normalizedLabel)
        );
      });
      return confirmed ? { status: 'VERIFIED' } : { status: 'REJECTED' };
    } catch {
      return { status: 'REJECTED' };
    }
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

  private async confirmOwnQid(
    qid: string,
    hintName: string,
  ): Promise<boolean | undefined> {
    let summaries: Map<string, { label?: string; aliases?: string[] }>;
    try {
      summaries = await this.wikidata!.getEntitySummaries([qid]);
    } catch {
      return false;
    }
    const summary = summaries.get(qid);
    if (!summary) return undefined;
    const needle = normalizeGeoName(hintName);
    return [summary.label, ...(summary.aliases ?? [])]
      .filter((label): label is string => Boolean(label))
      .some((label) =>
        hasSpecificNameOverlap(needle, normalizeGeoName(label), {
          requireAllTokens: true,
        }),
      );
  }

  private async confirmObservationQid(
    qid: string,
    hintName: string,
    candidateName: string,
  ): Promise<boolean | undefined> {
    let summaries: Map<string, { label?: string; aliases?: string[] }>;
    try {
      summaries = await this.wikidata!.getEntitySummaries([qid]);
    } catch {
      return false;
    }
    const summary = summaries.get(qid);
    if (!summary) return undefined;
    const needle = normalizeGeoName(hintName);
    const matchedName = normalizeGeoName(candidateName);
    return [summary.label, ...(summary.aliases ?? [])]
      .filter((label): label is string => Boolean(label))
      .some((label) => {
        const normalized = normalizeGeoName(label);
        return (
          hasSpecificNameOverlap(needle, normalized, {
            requireAllTokens: true,
          }) && hasSpecificNameOverlap(matchedName, normalized)
        );
      });
  }
}
