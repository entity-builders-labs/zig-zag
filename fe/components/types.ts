import { Activity } from '../features/activities/types';

export interface TourActivity {
  activity: Activity;
  order: number;
}

export interface Tour {
  id: string;
  name: string;
  description?: string;
  activities: TourActivity[];
}

export interface PaginatedResponseTour {
  tours: Tour[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export type PaginatedResponseActivity = {
  activities: Activity[];
  fromCache: boolean;
  crawlingTriggered: boolean;
  message: string;
};

export interface TourCardProps {
  tour: Tour;
  index: number;
  id: string;
  isActive: boolean;
  onPress: () => void;
  onDelete: () => void;
}
