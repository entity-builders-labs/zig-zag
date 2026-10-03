import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';
import {
  EntityCandidate,
  IdentityEvidence,
} from '../interfaces/experience-resolution.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import {
  hasSpecificNameOverlap,
  normalizeGeoName,
} from '../utils/nominatim-match.util';
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
          const hintMatched = this.matchesAny(hint.name, identities);
          const candidateMatched = ownQid
            ? true
            : this.matchesAny(candidate.canonicalName ?? '', identities);
          return [
            {
              type: 'WIKIDATA_IDENTITY_MATCH',
              source: ownQid ? 'OWN_QID' : 'OBSERVATION_QID',
              hintMatched,
              candidateMatched,
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

      // Check each SAME nearby Wikidata entity individually.
      // Only one and the same entity can corroborate both hint and candidate.
      const bothMatch = nearby.find(
        ({ label }) =>
          this.matchesAny(hint.name, [label]) &&
          this.matchesAny(candidate.canonicalName ?? '', [label]),
      );
      if (bothMatch) {
        return [
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'NEARBY',
            hintMatched: true,
            candidateMatched: true,
          },
        ];
      }

      // If no single entity matches both, check if an entity matches the hint.
      // Crucial: never combine hint matching entity A with candidate matching entity B.
      const hintMatch = nearby.find(({ label }) =>
        this.matchesAny(hint.name, [label]),
      );
      if (hintMatch) {
        return [
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'NEARBY',
            hintMatched: true,
            candidateMatched: false,
          },
        ];
      }

      const candidateMatch = nearby.find(({ label }) =>
        this.matchesAny(candidate.canonicalName ?? '', [label]),
      );
      if (candidateMatch) {
        return [
          {
            type: 'WIKIDATA_IDENTITY_MATCH',
            source: 'NEARBY',
            hintMatched: false,
            candidateMatched: true,
          },
        ];
      }

      return [
        {
          type: 'WIKIDATA_IDENTITY_MATCH',
          source: 'NEARBY',
          hintMatched: false,
          candidateMatched: false,
        },
      ];
    } catch {
      return [{ type: 'WIKIDATA_UNAVAILABLE' }];
    }
  }

  private matchesAny(name: string, identities: string[]): boolean {
    const normalizedName = normalizeGeoName(name);
    return identities.some((identity) =>
      hasSpecificNameOverlap(normalizedName, normalizeGeoName(identity), {
        requireAllTokens: true,
      }),
    );
  }
}
