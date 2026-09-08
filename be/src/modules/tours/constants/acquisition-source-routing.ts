export interface SourceCapabilityRoute {
  wikivoyageSections?: Array<'SEE' | 'DO' | 'EAT'>;
  osmConcepts?: string[];
  placesTypes?: string[];
  webKeywords?: string[];
}

/**
 * Conservative fallback for generic/dimensionless deficits.
 * Restricted to Wikivoyage broad discovery and Web only to avoid Places/OSM pollution.
 */
export const GENERIC_DEFICIT_ROUTE: SourceCapabilityRoute = {
  wikivoyageSections: ['SEE', 'DO', 'EAT'],
  webKeywords: ['top attractions', 'things to do'],
};

/**
 * Hand-maintained capability routing table keyed strictly by canonical Phase 2 `${dimension}:${key}`.
 * Exploration style is dormant and not routed.
 */
export const SOURCE_CAPABILITY_ROUTES: Record<
  string, // `${dimension}:${key}`
  SourceCapabilityRoute
> = {
  // Theme routes
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
  'theme:culture': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['arts_centre', 'gallery', 'museum'],
    placesTypes: ['art_gallery', 'museum'],
    webKeywords: ['cultural attractions', 'art'],
  },
  'theme:art': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['arts_centre', 'gallery', 'museum'],
    placesTypes: ['art_gallery', 'museum'],
    webKeywords: ['art galleries', 'art museums'],
  },
  'theme:architecture': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['building', 'historic'],
    placesTypes: ['place_of_worship', 'tourist_attraction'],
    webKeywords: ['architecture', 'historic landmarks'],
  },
  'theme:nature': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['nature_reserve', 'park'],
    placesTypes: ['campground', 'park'],
    webKeywords: ['nature reserves', 'parks'],
  },
  'theme:wine': {
    wikivoyageSections: ['EAT'],
    osmConcepts: ['vineyard', 'winery'],
    placesTypes: ['winery'],
    webKeywords: ['wineries', 'wine tasting'],
  },

  // Intent routes
  'intent:walk': {
    wikivoyageSections: ['DO'],
    osmConcepts: ['footway', 'hiking', 'route'],
    webKeywords: ['walking tours', 'walks'],
  },
  'intent:route_like': {
    wikivoyageSections: ['DO'],
    osmConcepts: ['hiking', 'route', 'scenic'],
    webKeywords: ['scenic routes', 'tours'],
  },
  'intent:day_trip': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['tourism'],
    placesTypes: ['tourist_attraction'],
    webKeywords: ['day trips', 'excursions'],
  },
  'intent:visit': {
    wikivoyageSections: ['SEE'],
    osmConcepts: ['historic', 'museum', 'tourism'],
    placesTypes: ['museum', 'tourist_attraction'],
    webKeywords: ['places to visit', 'attractions'],
  },
  'intent:food': {
    wikivoyageSections: ['EAT'],
    osmConcepts: ['cafe', 'restaurant'],
    placesTypes: ['cafe', 'restaurant'],
    webKeywords: ['food', 'dining'],
  },
  'intent:nightlife': {
    wikivoyageSections: ['DO'],
    osmConcepts: ['bar', 'nightclub', 'pub'],
    placesTypes: ['bar', 'night_club'],
    webKeywords: ['nightlife', 'bars'],
  },

  // Winery scale routes
  'winery_scale:boutique': {
    placesTypes: ['winery'],
    webKeywords: ['boutique wineries', 'small family vineyards'],
  },
  'winery_scale:medium': {
    placesTypes: ['winery'],
    webKeywords: ['wineries', 'vineyards'],
  },
  'winery_scale:industrial': {
    placesTypes: ['winery'],
    webKeywords: ['major wineries', 'large vineyards'],
  },

  // Tourism intensity routes
  'tourism_intensity:hidden': {
    wikivoyageSections: ['SEE', 'DO'],
    webKeywords: ['hidden gems', 'off the beaten path'],
  },
  'tourism_intensity:local': {
    wikivoyageSections: ['SEE', 'DO', 'EAT'],
    webKeywords: ['local favorites', 'neighborhood spots'],
  },
  'tourism_intensity:popular': {
    placesTypes: ['tourist_attraction'],
    webKeywords: ['popular attractions', 'top rated'],
  },
  'tourism_intensity:iconic': {
    placesTypes: ['tourist_attraction'],
    webKeywords: ['iconic landmarks', 'must see'],
  },

  // Nature type routes
  'nature_type:mountain': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['peak', 'volcano'],
    webKeywords: ['mountain trails', 'mountains'],
  },
  'nature_type:forest': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['forest', 'wood'],
    webKeywords: ['forests', 'woodland walks'],
  },
  'nature_type:coast': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['beach', 'coastline'],
    webKeywords: ['coastal views', 'beaches'],
  },
  'nature_type:river': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['river', 'waterway'],
    webKeywords: ['river walks', 'riverfront'],
  },
  'nature_type:desert': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['desert'],
    webKeywords: ['desert landscapes', 'dunes'],
  },
  'nature_type:park': {
    wikivoyageSections: ['SEE', 'DO'],
    osmConcepts: ['nature_reserve', 'park'],
    placesTypes: ['park'],
    webKeywords: ['parks', 'city parks'],
  },

  // Local character routes
  'local_character:authentic': {
    wikivoyageSections: ['SEE', 'EAT'],
    webKeywords: ['authentic neighborhood spots', 'traditional culture'],
  },
  'local_character:residential': {
    wikivoyageSections: ['SEE'],
    webKeywords: ['residential neighborhoods', 'quiet streets'],
  },
  'local_character:traditional': {
    wikivoyageSections: ['SEE', 'EAT'],
    webKeywords: ['traditional culture', 'heritage'],
  },
  'local_character:contemporary': {
    wikivoyageSections: ['SEE'],
    placesTypes: ['art_gallery'],
    webKeywords: ['contemporary culture', 'modern'],
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
