import type { Tour as ApiTour, PaginatedTours } from '../api/tours';
export type Tour = ApiTour;

/** Transitional response shape for the map search while that screen is migrated. */
export type PaginatedResponseActivity = {
  activities: any[];
  fromCache: boolean;
  crawlingTriggered: boolean;
  message: string;
};

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
