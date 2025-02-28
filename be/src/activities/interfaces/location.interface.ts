export interface Location {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  city?: string;
  country?: string;
  placeId?: string;
  phoneNumber?: string;
  website?: string;
  businessStatus?: string;
  rating?: number;
  ratingCount?: number;
  priceLevel?: number;
  photos?: string[];
}

export interface LocationWithDistance extends Location {
  distance: number;
}
