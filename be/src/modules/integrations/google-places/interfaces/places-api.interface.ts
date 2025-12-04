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
