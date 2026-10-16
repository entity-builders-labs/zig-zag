import { Injectable } from '@nestjs/common';
import { ExperienceVectorStoreService } from '@shared/ai/services/experience-vector-store.service';
import { SemanticSimilarityResult } from '@shared/ai/interfaces/embedding-index.interface';
import {
  ComposableExperience,
  PreferenceSpec,
} from '../interfaces/preference-spec.interface';
import { PreferenceUtilityResult } from '../interfaces/preference-utility.interface';
import { derivePreferenceUtility } from '../utils/preference-utility.util';

/**
 * The single canonical preference-utility derivation boundary (task 25.2).
 * It owns the request's one semantic-similarity batch and derives the typed
 * breakdown, order and ranks once per catalog snapshot, after hard
 * eligibility and before composition. Composition, planning and the trace
 * consume its result; none recomputes it.
 */
@Injectable()
export class PreferenceUtilityService {
  constructor(private readonly vectorStore: ExperienceVectorStoreService) {}

  async derive(input: {
    experiences: readonly ComposableExperience[];
    preferenceSpec: Pick<
      PreferenceSpec,
      'facets' | 'assertions' | 'semanticQuery'
    >;
    softAnchorIds: readonly string[];
  }): Promise<PreferenceUtilityResult> {
    const ids = [...new Set(input.experiences.map((e) => e.id))].sort();
    const semantic: SemanticSimilarityResult | null =
      input.preferenceSpec.semanticQuery.trim()
        ? await this.vectorStore.getSimilarityScores(
            ids,
            input.preferenceSpec.semanticQuery,
          )
        : null;
    return {
      ...derivePreferenceUtility({
        experiences: input.experiences,
        preferenceSpec: input.preferenceSpec,
        softAnchorIds: new Set(input.softAnchorIds),
        semantic,
      }),
      semanticRanking: semantic
        ? {
            status: semantic.status,
            requestedCandidateCount: semantic.requestedCandidateCount,
            indexedCandidateCount: semantic.indexedCandidateCount,
            identity: semantic.identity,
            reason: semantic.reason,
          }
        : {
            status: 'not_requested',
            requestedCandidateCount: 0,
            indexedCandidateCount: 0,
          },
    };
  }
}
