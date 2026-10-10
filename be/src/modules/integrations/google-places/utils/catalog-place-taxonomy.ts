export interface CatalogAcquisitionTypeGroup {
  primaryTypes: readonly string[];
  preferredTime: string;
}

/**
 * Provider-neutral catalog acquisition taxonomy.
 *
 * The planner uses it to ask for bounded categories, and admission uses the
 * same source to prove that a returned place belongs to the operation that
 * produced it. Keep provider-specific category translations in the adapter.
 */
export const CATALOG_ACQUISITION_TYPE_GROUPS = {
  visitor_landmarks: {
    primaryTypes: [
      'tourist_attraction',
      'historical_landmark',
      'historical_place',
      'cultural_landmark',
      'monument',
      'sculpture',
      'plaza',
      'observation_deck',
    ],
    preferredTime: 'day',
  },
  museums_and_arts: {
    primaryTypes: ['museum', 'history_museum', 'art_museum', 'art_gallery'],
    preferredTime: 'day',
  },
  outdoor: {
    primaryTypes: [
      'park',
      'national_park',
      'nature_preserve',
      'hiking_area',
      'beach',
    ],
    preferredTime: 'day',
  },
  food: {
    primaryTypes: ['restaurant', 'cafe', 'food_court'],
    preferredTime: 'any',
  },
  nightlife: {
    primaryTypes: ['bar', 'night_club'],
    preferredTime: 'night',
  },
  entertainment: {
    primaryTypes: [
      'amusement_park',
      'movie_theater',
      'performing_arts_theater',
    ],
    preferredTime: 'day',
  },
} as const satisfies Record<string, CatalogAcquisitionTypeGroup>;

export type CatalogAcquisitionCategory =
  keyof typeof CATALOG_ACQUISITION_TYPE_GROUPS;

export const INTEREST_ACQUISITION_CATEGORIES: Record<
  string,
  readonly CatalogAcquisitionCategory[]
> = {
  history: ['visitor_landmarks', 'museums_and_arts'],
  culture: ['visitor_landmarks', 'museums_and_arts'],
  art: ['visitor_landmarks', 'museums_and_arts'],
  architecture: ['visitor_landmarks', 'museums_and_arts'],
  photography: ['visitor_landmarks', 'museums_and_arts'],
  nature: ['outdoor'],
  outdoor: ['outdoor'],
  beach: ['outdoor'],
  hiking: ['outdoor'],
  food: ['food'],
  gastronomy: ['food'],
  nightlife: ['nightlife'],
  music: ['nightlife'],
  entertainment: ['entertainment'],
  family: ['entertainment'],
};

export function primaryTypesForAcquisitionCategory(
  category: string,
): readonly string[] {
  return (
    CATALOG_ACQUISITION_TYPE_GROUPS[category as CatalogAcquisitionCategory]
      ?.primaryTypes ?? []
  );
}
