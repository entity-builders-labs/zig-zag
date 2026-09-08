export interface SourceCapabilityRoute {
  wikivoyageSections?: Array<'SEE' | 'DO' | 'EAT'>;
  osmConcepts?: string[];
  placesTypes?: string[];
  webKeywords?: string[];
}

export const GENERIC_DEFICIT_ROUTE: SourceCapabilityRoute = {
  wikivoyageSections: ['SEE', 'DO', 'EAT'],
  osmConcepts: ['tourism', 'historic', 'amenity'],
  placesTypes: ['tourist_attraction', 'point_of_interest'],
  webKeywords: ['top attractions', 'things to do'],
};

export const SOURCE_CAPABILITY_ROUTES: Record<
  string, // `${dimension}:${key}`
  SourceCapabilityRoute
> = {
  'theme:history': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['historic', 'museum'],
    placesTypes: ['museum', 'tourist_attraction'],
    webKeywords: ['history', 'historic sites'],
  },
  'theme:food': {
    wikivoyageSections: ['EAT'],
    osmConcepts: ['restaurant', 'cafe'],
    placesTypes: ['restaurant', 'bakery', 'cafe'],
    webKeywords: ['food', 'restaurants'],
  },
  'theme:culinary': {
    wikivoyageSections: ['EAT'],
    osmConcepts: ['restaurant', 'cafe'],
    placesTypes: ['restaurant', 'bakery', 'cafe'],
    webKeywords: ['culinary', 'restaurants'],
  },
  'theme:culture': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['museum', 'gallery', 'arts_centre'],
    placesTypes: ['art_gallery', 'museum'],
    webKeywords: ['cultural attractions', 'art'],
  },
  'theme:art': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['museum', 'gallery', 'arts_centre'],
    placesTypes: ['art_gallery', 'museum'],
    webKeywords: ['art galleries', 'art museums'],
  },
  'cuisine:wine': {
    wikivoyageSections: ['EAT'],
    osmConcepts: ['winery', 'vineyard'],
    placesTypes: ['winery'],
    webKeywords: ['wineries', 'wine tasting'],
  },
  'cuisine:winery': {
    wikivoyageSections: ['EAT'],
    osmConcepts: ['winery', 'vineyard'],
    placesTypes: ['winery'],
    webKeywords: ['wineries', 'wine tasting'],
  },
  'setting:outdoors': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['park', 'nature_reserve'],
    placesTypes: ['park', 'campground'],
    webKeywords: ['parks', 'outdoors'],
  },
  'setting:nature': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['park', 'nature_reserve'],
    placesTypes: ['park', 'campground'],
    webKeywords: ['nature reserves', 'parks'],
  },
  'category:architecture': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['building', 'historic'],
    placesTypes: ['tourist_attraction', 'place_of_worship'],
    webKeywords: ['architecture', 'historic landmarks'],
  },
  'vibe:relaxed': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['park', 'viewpoint'],
    placesTypes: ['park'],
    webKeywords: ['scenic viewpoints', 'walks'],
  },
  'vibe:scenic': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['park', 'viewpoint'],
    placesTypes: ['park'],
    webKeywords: ['scenic viewpoints', 'walks'],
  },
};

export function lookupSourceCapabilityRoute(
  dimension?: string,
  key?: string,
): SourceCapabilityRoute | undefined {
  if (!dimension || !key) {
    return GENERIC_DEFICIT_ROUTE;
  }

  // exploration_style must remain completely dormant
  if (dimension === 'exploration_style') {
    return undefined;
  }

  const lookupKey = `${dimension.toLowerCase().trim()}:${key.toLowerCase().trim()}`;
  if (SOURCE_CAPABILITY_ROUTES[lookupKey]) {
    return SOURCE_CAPABILITY_ROUTES[lookupKey];
  }

  // Fallback for unknown dimensions / keys: web ONLY with sanitized key
  return {
    webKeywords: [key.toLowerCase().trim()],
  };
}
