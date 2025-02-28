export interface GoogleMapsLocation {
  latitude: number;
  longitude: number;
  address: string;
  placeId?: string;
}

export interface GoogleMapsActivity {
  placeId: string;
  name: string;
  description?: string;
  location: GoogleMapsLocation;
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

export interface GoogleMapsApiResponse {
  results: GoogleMapsActivity[];
  status: string;
  nextPageToken?: string;
}
