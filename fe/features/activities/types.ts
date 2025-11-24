export interface Activity {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  order: number;
  formattedAddress: string;
  knownActivityTypeName: string;
  rating?: number;
  ratingCount?: number;
  priceLevel?: number;
  distance?: number; // computed in backend (km)
  weightedScore?: number; // bayesian weighted rating, computed in backend
}

export type PaginatedResponseActivity = Activity[];
