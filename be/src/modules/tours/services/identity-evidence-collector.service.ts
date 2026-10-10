import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';
import {
  EntityCandidate,
  IdentityEvidence,
  NameCorrespondence,
} from '../interfaces/experience-resolution.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import {
  bestNameCorrespondence,
  nameCorrespondence,
} from '../utils/identity-name-correspondence.util';
import { sourceDeclaredWikidataQid } from '../utils/identity-evidence-builder.util';

const CONFIRMATION_RADIUS_METERS = 200;

/**
 * Acquires normalized Wikidata identity facts for a transient candidate.
 * It deliberately owns transport and normalization only; IdentityVerifier
 * remains the sole authority that interprets the resulting evidence.
 */
export class IdentityEvidenceCollector {
  constructor(private readonly wikidata?: IWikidataApiService) {}

  async collect(
    hint: { name: string; evidenceKeys?: string[] },
    candidate: EntityCandidate,
    observations: SourceObservation[] = [],
  ): Promise<IdentityEvidence[]> {
    if (!this.wikidata) return [];

    const ownQid = candidate.wikidataQid;
    const qid = ownQid ?? sourceDeclaredWikidataQid(hint, observations);
    if (qid) {
      try {
        const summaries = await this.wikidata.getEntitySummaries([qid]);
        const summary = summaries.get(qid);
        if (summary) {
          const identities = [summary.label, ...(summary.aliases ?? [])].filter(
            (label): label is string => Boolean(label),
          );
          // The side that carries the item is linked structurally; the
          // other side only through its name, graded for verification
          // (an OVERLAP is retrieval-grade and never decisive).
          return [
            ownQid
              ? {
                  type: 'WIKIDATA_IDENTITY_MATCH',
                  source: 'OWN_QID',
                  hintCorrespondence: bestNameCorrespondence(
                    hint.name,
                    identities,
                  ),
                  candidateCorrespondence: 'DECLARES_QID',
                }
              : {
                  type: 'WIKIDATA_IDENTITY_MATCH',
                  source: 'OBSERVATION_QID',
                  hintCorrespondence: 'DECLARES_QID',
                  candidateCorrespondence: bestNameCorrespondence(
                    candidate.canonicalName ?? '',
                    identities,
                  ),
                },
          ];
        }
      } catch {
        return [{ type: 'WIKIDATA_UNAVAILABLE' }];
      }
    }

    if (
      !Number.isFinite(candidate.latitude) ||
      !Number.isFinite(candidate.longitude)
    ) {
      return [];
    }
    try {
      const nearby = await this.wikidata.findNearbyPlaces(
        candidate.latitude as number,
        candidate.longitude as number,
        CONFIRMATION_RADIUS_METERS,
      );

      // Each nearby item is judged on its own: only one and the same item
      // can corroborate both hint and candidate, never hint matching item A
      // with candidate matching item B. Preference: the item naming both
      // most strongly, then an item naming the hint, then one naming the
      // candidate.
      const graded = nearby.map(({ label }) => ({
        hint: nameCorrespondence(hint.name, label),
        candidate: nameCorrespondence(candidate.canonicalName ?? '', label),
      }));
      const strength = (c: NameCorrespondence) =>
        c === 'EQUIVALENT' ? 2 : c === 'OVERLAP' ? 1 : 0;
      const namingBoth = graded
        .filter((g) => g.hint !== 'NONE' && g.candidate !== 'NONE')
        .sort(
          (a, b) =>
            strength(b.hint) +
            strength(b.candidate) -
            (strength(a.hint) + strength(a.candidate)),
        )[0];
      const namingHint = graded.find((g) => g.hint !== 'NONE');
      const namingCandidate = graded.find((g) => g.candidate !== 'NONE');
      const [hintCorrespondence, candidateCorrespondence]: [
        NameCorrespondence,
        NameCorrespondence,
      ] = namingBoth
        ? [namingBoth.hint, namingBoth.candidate]
        : namingHint
          ? [namingHint.hint, 'NONE']
          : namingCandidate
            ? ['NONE', namingCandidate.candidate]
            : ['NONE', 'NONE'];
      return [
        {
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'NEARBY',
          hintCorrespondence,
          candidateCorrespondence,
        },
      ];
    } catch {
      return [{ type: 'WIKIDATA_UNAVAILABLE' }];
    }
  }
}
