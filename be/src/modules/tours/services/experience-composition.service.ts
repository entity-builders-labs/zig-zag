import { Injectable } from '@nestjs/common';
import {
  CompositionCandidate,
  CompositionSelectionResult,
  PreferenceSpec,
  facetKey,
} from '../interfaces/preference-spec.interface';
import { candidateMatchesPreferenceFacet } from '../utils/preference-facet-matching.util';
import { preferenceWeightForExperience } from '../utils/preference-facet-matching.util';
import {
  requestedFacetToPreferenceFacet,
  isStrongFacetMatch,
} from '../utils/preference-strong-match.util';
import {
  computeExplorationSignals,
  computeExplorationTilt,
} from '../utils/exploration-signals.util';
import { composeSet } from '../utils/composition-set-cover.util';
import { ExperienceVectorStoreService } from '@shared/ai/services/experience-vector-store.service';

export interface ExperienceCompositionInput {
  experiences: any[];
  preferenceSpec: PreferenceSpec;
  /** A future venue-resolution boundary supplies these canonical IDs. */
  resolvedVenueMustIds?: string[];
  resolvedVenueSoftIds?: string[];
  resolvedVenueMustAnchorNames?: string[];
}

export interface ExperienceCompositionOutput {
  result: CompositionSelectionResult;
  candidatesById: Map<string, any>;
  preferenceWeightById: Map<string, number>;
}

@Injectable()
export class ExperienceCompositionService {
  constructor(private readonly vectorStore: ExperienceVectorStoreService) {}

  async compose(
    input: ExperienceCompositionInput,
  ): Promise<ExperienceCompositionOutput> {
    const deduped = new Map(
      input.experiences.map((experience) => [experience.id, experience]),
    );
    const experiences = [...deduped.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const semantic = input.preferenceSpec.semanticQuery.trim()
      ? await this.vectorStore.getSimilarityScores(
          experiences.map((experience) => experience.id),
          input.preferenceSpec.semanticQuery,
        )
      : null;
    const candidates: CompositionCandidate[] = experiences.map((experience) => {
      const components = Array.isArray(experience.components)
        ? experience.components
        : [];
      const isBareAreaOrRoute =
        components.length === 1 &&
        ['AREA', 'ROUTE'].includes(
          String(components[0]?.geoEntity?.kind ?? '').toUpperCase(),
        );
      const satisfiedFacets = input.preferenceSpec.facets
        .filter(
          (facet) =>
            isStrongFacetMatch(experience, facet) &&
            candidateMatchesPreferenceFacet(
              experience,
              requestedFacetToPreferenceFacet(facet),
            ),
        )
        .map(facetKey);
      const metadata =
        experience.metadata && typeof experience.metadata === 'object'
          ? experience.metadata
          : {};
      const signals = computeExplorationSignals({
        placesReviewCount: metadata.reviewCount ?? metadata.userRatingCount,
        wikidataSitelinkCount: metadata.wikidataSitelinkCount,
        wikipediaPresent: metadata.wikipediaPresent,
        wikivoyageListed: metadata.wikivoyageListed,
        heritageOrLandmark: metadata.heritageOrLandmark,
        explicitTourismIntensityEvidence:
          metadata.explorationEvidence?.tourismIntensity,
        explicitLocalCharacterEvidence:
          metadata.explorationEvidence?.localCharacter,
      });
      const softAnchorBoost = (input.resolvedVenueSoftIds ?? []).includes(
        experience.id,
      )
        ? 1
        : 0;
      return {
        id: experience.id,
        componentCount: isBareAreaOrRoute ? 0 : components.length,
        satisfiedFacets,
        qualityScore:
          typeof experience.qualityScore === 'number'
            ? experience.qualityScore
            : null,
        explorationSignals: signals,
        explorationTilt: computeExplorationTilt(
          input.preferenceSpec.explorationStyle,
          signals,
        ).score,
        semanticSimilarity:
          semantic?.status === 'applied'
            ? (semantic.scores.get(experience.id) ?? 0)
            : 0,
        groundingStrength: satisfiedFacets.length > 0 ? 1 : 0,
        matchesHardExclusion: false,
        softAnchorBoost,
        isPerformanceVenue:
          Array.isArray(experience.traits) &&
          experience.traits.includes('performance_venue'),
      };
    });
    return {
      result: composeSet({
        candidates,
        preferenceSpec: input.preferenceSpec,
        resolvedVenueMustIds: input.resolvedVenueMustIds,
        resolvedVenueMustAnchorNames: input.resolvedVenueMustAnchorNames,
      }),
      candidatesById: deduped,
      preferenceWeightById: new Map(
        experiences.map((experience) => [
          experience.id,
          preferenceWeightForExperience(
            experience,
            input.preferenceSpec.facets,
          ),
        ]),
      ),
    };
  }
}
