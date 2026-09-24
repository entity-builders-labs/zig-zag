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
    const qid = ownQid ?? this.observationQid(hint, observations);
    if (qid) {
      try {
        const summaries = await this.wikidata.getEntitySummaries([qid]);
        const summary = summaries.get(qid);
        if (summary) {
          const identities = [summary.label, ...(summary.aliases ?? [])].filter(
            (label): label is string => Boolean(label),
          );
          // An OWN_QID for a ROUTE candidate (a street/way) does not carry
          // the same name-collision risk a PLACE/venue OWN_QID does: two
          // genuinely different real venues can legitimately share one
          // specific token (e.g. a neighborhood name -- "Recoleta Cemetery"
          // vs. the unrelated "Hotel Urban Suites Recoleta"), so a PLACE hint
          // keeps the strict 100%-token bar unchanged. A street name is a
          // single administratively-assigned linear feature per area with a
          // near-universal English/Spanish category-suffix translation
          // ("Street"/"Avenue" <-> "Calle"/"Avenida") that the extractor LLM
          // often appends and the OSM/Wikidata canonical name never carries
          // ("Defensa Street" vs. the real street's own name "Defensa") --
          // the existing permissive "matching" bar (already used elsewhere
          // for this exact cross-language case, see nominatim-match.util.ts's
          // bestNominatimMatch) is the structurally-justified exception, not
          // a generic threshold relaxation.
          const hintMatched =
            ownQid && candidate.kind === 'ROUTE'
              ? this.matchesAny(hint.name, identities, {
                  requireAllTokens: false,
                })
              : this.matchesAny(hint.name, identities);
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

  private observationQid(
    hint: { evidenceKeys?: string[] },
    observations: SourceObservation[],
  ): string | undefined {
    for (const key of hint.evidenceKeys ?? []) {
      const qid = observations.find((item) => item.evidenceKey === key)
        ?.canonicalIdentity?.wikidataQid;
      if (qid) return qid;
    }
    return undefined;
  }

  private matchesAny(
    name: string,
    identities: string[],
    options: { requireAllTokens: boolean } = { requireAllTokens: true },
  ): boolean {
    const normalizedName = normalizeGeoName(name);
    return identities.some((identity) =>
      hasSpecificNameOverlap(
        normalizedName,
        normalizeGeoName(identity),
        options,
      ),
    );
  }
}
