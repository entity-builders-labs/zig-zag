export interface ActivityPhoto {
  url: string;
  thumbnail?: string;
  author?: string;
  license?: string;
  caption?: string;
  width?: number;
  height?: number;
  sourceProvider: string;
}

export interface ActivityEnrichmentResult {
  photos: ActivityPhoto[];
  highlights?: string[];
  curatorTip?: string;
  rawExtract?: string;
  status: 'enriched' | 'partial' | 'failed';
  provider: string;
}

export interface PhotoEnrichmentQuery {
  id?: string;
  name: string;
  category?: string;
  kind?: string;
  latitude?: number;
  longitude?: number;
  wikidataId?: string;
  placeId?: string;
  formattedAddress?: string;
  destinationName?: string;
  destinationCountry?: string;
}

export interface IPhotoEnrichmentProvider {
  readonly providerName: string;
  enrichActivity(
    query: PhotoEnrichmentQuery,
  ): Promise<ActivityEnrichmentResult>;
  enrichBatch?(
    queries: PhotoEnrichmentQuery[],
  ): Promise<Map<string, ActivityEnrichmentResult>>;
}
