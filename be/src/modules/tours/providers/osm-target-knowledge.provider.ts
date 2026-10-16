import { TargetObservationFact } from '../preferences/target-knowledge.interface';

/**
 * OSM structured target-knowledge producer (task 25.7, owner 2026-10-16).
 * Maps OSM tags to provider-neutral target observations:
 *   wheelchair=yes       -> accessibility:wheelchair_access SATISFIES
 *   wheelchair=no        -> accessibility:wheelchair_access DOES_NOT_SATISFY
 *   wheelchair=limited   -> accessibility:wheelchair_access INCONCLUSIVE
 *   diet:vegan=yes|only  -> dietary_suitability:vegan SATISFIES
 *   diet:vegan=no        -> dietary_suitability:vegan DOES_NOT_SATISFY
 * It never derives avoid_stairs or limited_mobility from wheelchair=*, and a
 * missing or unsupported value produces no observation (UNKNOWN).
 */
export function osmTargetFacts(element: {
  id: string;
  tags: Readonly<Record<string, string>>;
}): TargetObservationFact[] {
  const facts: TargetObservationFact[] = [];

  const wheelchair = element.tags['wheelchair'];
  if (wheelchair === 'yes') {
    facts.push({
      target: { dimension: 'accessibility', key: 'wheelchair_access' },
      observation: {
        sourceFactId: `${element.id}:wheelchair`,
        state: 'SATISFIES',
      },
    });
  } else if (wheelchair === 'no') {
    facts.push({
      target: { dimension: 'accessibility', key: 'wheelchair_access' },
      observation: {
        sourceFactId: `${element.id}:wheelchair`,
        state: 'DOES_NOT_SATISFY',
      },
    });
  } else if (wheelchair === 'limited') {
    facts.push({
      target: { dimension: 'accessibility', key: 'wheelchair_access' },
      observation: {
        sourceFactId: `${element.id}:wheelchair`,
        state: 'INCONCLUSIVE',
      },
    });
  }

  const dietVegan = element.tags['diet:vegan'];
  if (dietVegan === 'yes' || dietVegan === 'only') {
    facts.push({
      target: { dimension: 'dietary_suitability', key: 'vegan' },
      observation: {
        sourceFactId: `${element.id}:diet:vegan`,
        state: 'SATISFIES',
      },
    });
  } else if (dietVegan === 'no') {
    facts.push({
      target: { dimension: 'dietary_suitability', key: 'vegan' },
      observation: {
        sourceFactId: `${element.id}:diet:vegan`,
        state: 'DOES_NOT_SATISFY',
      },
    });
  }

  return facts;
}
