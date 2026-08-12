export interface PlaceData {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  name?: string;
  // Google's New Places API returns a string enum, not the old numeric 0-4
  // price level — see priceLevelToNumber() in google-places.service.ts.
  priceLevel?: string;
  // One human-readable line per weekday (Google's own format, e.g.
  // "Monday: 9:00 AM – 6:00 PM"), when the provider exposes it.
  openingHoursWeekdayText?: string[];
}

export interface PlacesSearchNearbyParams {
  latitude: number;
  longitude: number;
  radius: number;
  includedTypes?: string[];
  maxResultCount?: number;
  rankPreference?: 'DISTANCE' | 'POPULARITY';
}

export interface PlacesSearchTextParams {
  textQuery: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  maxResultCount?: number;
}

export interface IPlacesApiService {
  searchNearby(params: PlacesSearchNearbyParams): Promise<PlaceData[]>;
  searchText(params: PlacesSearchTextParams): Promise<PlaceData[]>;
  getPlaceDetails(placeId: string): Promise<Partial<PlaceData>>;
}
