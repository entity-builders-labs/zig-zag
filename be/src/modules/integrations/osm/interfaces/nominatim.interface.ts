export interface NominatimResult {
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  // Nominatim's own place classification — 'city'/'town'/'village' is what
  // destination-resolution.service.ts uses to decide area-scale vs
  // point-scale; 'state'/'country' and everything finer-grained than a
  // settlement falls back to point-scale. See NEIGHBORHOOD_ADMIN_LEVEL note
  // in osm-places.service.ts for why admin_level alone can't do this job.
  addresstype: string;
  displayName: string;
  importance: number;
  latitude?: number;
  longitude?: number;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    cityDistrict?: string;
    stateDistrict?: string;
    county?: string;
    borough?: string;
    suburb?: string;
    state?: string;
    country?: string;
    countryCode?: string;
  };
}

export interface NominatimSearchOptions {
  /**
   * ISO 3166-1 alpha-2 country code (e.g. "ar") to restrict results to. A
   * plain name search alone can return a same-named place in a completely
   * different, unrelated country when the name is generic/common — verified
   * live against the real API: "Cerro Alcázar" and "Catedral de San Juan
   * Bautista" both resolved to Spain instead of San Juan, Argentina without
   * this; adding it resolved both correctly.
   */
  countryCode?: string;
}

export interface INominatimApiService {
  search(
    query: string,
    options?: NominatimSearchOptions,
  ): Promise<NominatimResult[]>;
  reverse(latitude: number, longitude: number): Promise<NominatimResult | null>;
}
