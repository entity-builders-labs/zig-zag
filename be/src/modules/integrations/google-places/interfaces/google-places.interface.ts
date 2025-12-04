export interface GooglePlacesLocation {
  latitude: number;
  longitude: number;
  address: string;
  placeId?: string;
}

export interface GooglePlacesActivity {
  placeId: string;
  name: string;
  description?: string;
  location: GooglePlacesLocation;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  types?: string[];
  photos?: string[];
  openingHours?: {
    periods: OpeningPeriod[];
    weekdayText: string[];
  };
}

export interface OpeningPeriod {
  open: TimeOfDay;
  close: TimeOfDay;
}

export interface TimeOfDay {
  day: number;
  time: string;
}

export interface GooglePlacesApiResponse {
  results: GooglePlacesActivity[];
  status: string;
  nextPageToken?: string;
}
