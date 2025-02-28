export interface Activity {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  order: number;
  formattedAddress: string;
  knownActivityTypeName: string;
}

export type PaginatedResponseActivity = Activity[];
