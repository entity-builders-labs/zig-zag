export interface NominatimResult {
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  // Nominatim's own address-hierarchy classification (city/town/village/
  // suburb/state/country/...). This is descriptive evidence; area-scale
  // eligibility also requires a positive rank signal below.
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
  // Nominatim's numeric hierarchy signals. They are normalized here so the
  // domain policy can reason about scale without reading the raw response.
  placeRank?: number;
  addressRank?: number;
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
  /**
   * Soft proximity bias toward the request's destination. Nominatim's own
   * `importance` ranking has no awareness of the requested destination, and
   * `countryCode` alone can still lose a real match to a same/similar-named,
   * more "important" place elsewhere in a large country before it ever
   * reaches the caller — the top-result-limited response never contains the
   * real match, so no amount of client-side re-ranking against this same
   * point can recover it. This narrows the search itself, not just the
   * caller's later choice among whatever came back. Deliberately soft (no
   * `bounded` filter): a genuine match outside the bias radius is
   * deprioritized, never hard-excluded.
   */
  bias?: {
    latitude: number;
    longitude: number;
  };
}

/**
 * Nominatim's structured-search fields. Nominatim rejects mixing these with
 * the free-form `q` parameter, so structured search is a separate method
 * (`searchStructured`) rather than an option silently folded into `search`.
 */
export interface NominatimStructuredQuery {
  street?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  postalcode?: string;
}

export interface INominatimApiService {
  /** Free-form search (`q=`). */
  search(
    query: string,
    options?: NominatimSearchOptions,
  ): Promise<NominatimResult[]>;
  /**
   * Structured search (`street=`/`city=`/...), never combined with `q=`.
   * Same `countryCode`/`bias` options and result limit as `search`.
   */
  searchStructured(
    query: NominatimStructuredQuery,
    options?: NominatimSearchOptions,
  ): Promise<NominatimResult[]>;
  reverse(latitude: number, longitude: number): Promise<NominatimResult | null>;
}
