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
}

export interface INominatimApiService {
  search(query: string): Promise<NominatimResult[]>;
}
