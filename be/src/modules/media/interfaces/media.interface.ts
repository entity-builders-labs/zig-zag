export interface DocumentaryPhoto {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
  author?: string;
  authorUrl?: string;
  license?: string;
  licenseUrl?: string;
  sourceUrl?: string;
  provider: 'wikimedia_commons' | 'google_places';
}

export type MediaLookupOutcome =
  | 'FOUND'
  | 'AUTHORITATIVE_EMPTY'
  | 'RETRYABLE_FAILURE'
  | 'PERMANENT_FAILURE';

export type MediaLookupResult =
  | {
      outcome: 'FOUND';
      photos: DocumentaryPhoto[];
    }
  | {
      outcome: 'AUTHORITATIVE_EMPTY';
      photos: [];
    }
  | {
      outcome: 'RETRYABLE_FAILURE' | 'PERMANENT_FAILURE';
      photos: [];
      error: string;
    };

export interface MediaPresentation {
  photos: DocumentaryPhoto[];
  primaryPhoto: {
    url: string;
    caption?: string;
    author?: string;
    license?: string;
    licenseUrl?: string;
    isFallback: boolean;
  };
  source: 'DOCUMENTARY' | 'CURATED_FALLBACK';
}

export interface ActivityMediaEnrichmentPayload {
  activityId: string;
  name: string;
  destinationLabel?: string;
  wikidataId?: string;
  latitude: number;
  longitude: number;
  category?: string;
}

export interface ActivityMediaUpdatedPayload {
  activityId: string;
  mediaStatus: 'ENRICHED' | 'FAILED';
  photoCount: number;
  mediaUpdatedAt: string;
  photos?: DocumentaryPhoto[];
}
