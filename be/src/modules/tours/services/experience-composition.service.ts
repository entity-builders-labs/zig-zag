import { Injectable } from '@nestjs/common';
import {
  CompositionCandidate,
  CompositionSelectionResult,
  PreferenceSpec,
  ComposableExperience,
} from '../interfaces/preference-spec.interface';
import { PreferenceUtilityResult } from '../interfaces/preference-utility.interface';
import {
  computeExplorationSignals,
  computeExplorationTilt,
} from '../utils/exploration-signals.util';
import { composeSet } from '../utils/composition-set-cover.util';

export interface ExperienceCompositionInput {
  experiences: ComposableExperience[];
  preferenceSpec: PreferenceSpec;
  /** The canonical preference utility of these Experiences (task 25.2). */
  preferenceUtility: PreferenceUtilityResult;
  /** A future venue-resolution boundary supplies these canonical IDs. */
  resolvedVenueMustIds?: string[];
  resolvedVenueMustAnchorNames?: string[];
}

export interface ExperienceCompositionOutput {
  result: CompositionSelectionResult;
  candidatesById: Map<string, ComposableExperience>;
}

/**
 * Set composition over the canonical preference utility: a consumer of the
 * utility boundary, never a second ranking authority.
 */
@Injectable()
export class ExperienceCompositionService {
  compose(input: ExperienceCompositionInput): ExperienceCompositionOutput {
    const deduped = new Map(
      input.experiences.map((experience) => [experience.id, experience]),
    );
    const experiences = [...deduped.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const candidates: CompositionCandidate[] = experiences.map((experience) => {
      const components = experience.components ?? [];
      const isBareAreaOrRoute =
        components.length === 1 &&
        ['AREA', 'ROUTE'].includes(
          String(components[0]?.geoEntity?.kind ?? '').toUpperCase(),
        );
      const utility = input.preferenceUtility.byId.get(experience.id);
      if (!utility) {
        throw new Error(
          `Composition received Experience ${experience.id} without a preference-utility assessment`,
        );
      }
      const dimensionedTraits = experience.dimensionedTraits ?? [];
      const explorationFacts = experience.explorationFacts ?? {};
      const tourismIntensityEvidence = dimensionedTraits
        .filter((item: any) => item.dimension === 'tourism_intensity')
        .map((item: any) => ({
          strength: item.key === 'iconic' ? 1 : 0,
          evidenceKey: `dimensioned_trait:${item.dimension}:${item.key}`,
          source: 'catalog_classification',
        }));
      const localCharacterEvidence = dimensionedTraits
        .filter((item: any) => item.dimension === 'local_character')
        .map((item: any) => ({
          strength: item.key === 'authentic' ? 1 : 0,
          evidenceKey: `dimensioned_trait:${item.dimension}:${item.key}`,
          source: 'catalog_classification',
        }));
      const signals = computeExplorationSignals({
        ...explorationFacts,
        explicitTourismIntensityEvidence: [
          ...tourismIntensityEvidence,
          ...(explorationFacts.explicitTourismIntensityEvidence ?? []),
        ],
        explicitLocalCharacterEvidence: [
          ...localCharacterEvidence,
          ...(explorationFacts.explicitLocalCharacterEvidence ?? []),
        ],
      });
      return {
        id: experience.id,
        componentCount: isBareAreaOrRoute ? 0 : components.length,
        satisfiedFacets: utility.matchedFacets,
        levelRank: utility.levelRank,
        explorationSignals: signals,
        explorationTilt: computeExplorationTilt(
          input.preferenceSpec.explorationStyle,
          signals,
        ).score,
        softAnchor: utility.breakdown.softAnchor,
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
    };
  }
}
