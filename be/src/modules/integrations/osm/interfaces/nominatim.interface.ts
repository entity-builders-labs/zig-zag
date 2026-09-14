export interface NominatimResult {
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  // Nominatim's own address-hierarchy classification (city/town/village/
  // suburb/state/country/...). Cutover M3.5: area-scale acceptance is no
  // longer a whitelist of specific narrow terms read from this field alone
  // -- see `isAreaScaleEligible` (nominatim-match.util.ts), which combines
  // this with `class`/`type` below.
  addresstype: string;
  // Nominatim's own top-level OSM tag classification for this result (e.g.
  // 'boundary', 'place', 'highway', 'building', 'amenity', 'shop',
  // 'natural'). A small, stable, provider-native vocabulary -- NOT the
  // same thing as `addresstype`'s finer-grained hierarchy term. The one
  // "is this a genuine administrative/populated-place concept at all"
  // signal `isAreaScaleEligible` needs; a building/POI/street mapped as a
  // way/relation never gets `class: 'boundary'` or `'place'`.
  class?: string;
  // The specific OSM tag value under `class` (e.g. 'administrative' under
  // 'boundary'; 'city'/'town'/'suburb'/'neighbourhood'/... under 'place').
  // Retained for provenance/debugging; `isAreaScaleEligible` does not read
  // it directly (addresstype already carries the equivalent finer-grained
  // classification for the address-hierarchy use case).
  type?: string;
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
