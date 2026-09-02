import type { Tour as ApiTour, PaginatedTours } from '../api/tours';
export type Tour = ApiTour;


export interface PaginatedResponseTour {
  tours: Tour[];
  meta: PaginatedTours['meta'];
}

export interface TourCardProps {
  tour: Tour;
  index: number;
  id: string;
  isActive: boolean;
  onPress: () => void;
  onDelete: () => void;
}
