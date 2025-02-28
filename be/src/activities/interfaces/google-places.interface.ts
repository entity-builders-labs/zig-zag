export interface GooglePlacePhoto {
  photoReference: string;
  height: number;
  width: number;
  htmlAttributions: string[];
}

export interface GooglePlaceDetails {
  placeId: string;
  formattedAddress: string;
  phoneNumber?: string;
  website?: string;
  rating?: number;
  userRatingsTotal?: number;
  businessStatus?: string;
  priceLevel?: number;
  photos?: GooglePlacePhoto[];
}
