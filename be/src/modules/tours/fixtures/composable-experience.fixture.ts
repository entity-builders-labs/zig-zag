import { ComposableExperience } from '../interfaces/preference-spec.interface';
import { catalogMatchFacts } from '../utils/experience-match-facts.util';

/**
 * A ComposableExperience whose typed match facts come from the catalog
 * adapter, exactly as the catalog projection derives them; tests never
 * fabricate facts by hand.
 */
export function composableExperience(
  input: Omit<ComposableExperience, 'matchFacts'> & {
    classification?: unknown;
    durationMinutes?: number | null;
  },
): ComposableExperience {
  const { classification, durationMinutes, ...experience } = input;
  return {
    ...experience,
    matchFacts: catalogMatchFacts({
      themes: input.themes ?? [],
      intents: input.intents ?? [],
      dimensionedTraits: input.dimensionedTraits ?? [],
      classification,
      components: input.components ?? [],
      qualityScore: input.qualityScore ?? null,
      durationMinutes: durationMinutes ?? null,
    }),
  };
}

/**
 * A catalog-row fixture with the `matchFacts` the catalog projection would
 * attach, adapted from the row's own persisted fields.
 */
export function withCatalogMatchFacts<
  T extends {
    themes?: readonly string[];
    intents?: readonly string[];
    dimensionedTraits?: readonly unknown[];
    metadata?: unknown;
    components?: readonly unknown[];
    qualityScore?: number | null;
    durationMinutes?: number | null;
  },
>(row: T) {
  return {
    ...row,
    matchFacts: catalogMatchFacts({
      themes: row.themes ?? [],
      intents: row.intents ?? [],
      dimensionedTraits: row.dimensionedTraits ?? [],
      classification:
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as { classification?: unknown }).classification
          : undefined,
      components: row.components ?? [],
      qualityScore: row.qualityScore ?? null,
      durationMinutes: row.durationMinutes ?? null,
    }),
  };
}
