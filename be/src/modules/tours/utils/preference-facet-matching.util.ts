import { SemanticTarget } from '../preferences/preference-assertion.interface';
import { ExperienceSemanticFacts } from '../interfaces/experience-match-facts.interface';
import { PREFERENCE_DIMENSIONS } from '../preferences/preference-facet-vocabulary';

/**
 * Pure facet-matching primitive: whether the Experience's typed semantic
 * facts carry the typed target (a closed dimension and canonical key).
 * Theme and intent targets match the typed theme/intent lists; every other
 * closed dimension matches an explicit dimensioned fact only. Facts are
 * produced once by the boundary adapters (`experience-match-facts.util.ts`);
 * this primitive reads no metadata, name, description or free text, and an
 * absent fact is UNKNOWN, never a match.
 */
export function candidateMatchesPreferenceFacet(
  facts: ExperienceSemanticFacts,
  target: SemanticTarget,
): boolean {
  if (target.dimension === PREFERENCE_DIMENSIONS.THEME) {
    return facts.themes.includes(target.key);
  }
  if (target.dimension === PREFERENCE_DIMENSIONS.INTENT) {
    return facts.intents.includes(target.key);
  }
  return facts.dimensionedFacts.some(
    (fact) => fact.dimension === target.dimension && fact.key === target.key,
  );
}
