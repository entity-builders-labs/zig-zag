export interface TourNotificationPayload {
  tourId: string;
  userId?: string;
  status: string;
  progress?: number;
  message?: string;
  coverImage?: string;
  data?: any;
}

export interface ExperienceMediaNotificationPayload {
  experienceId: string;
  mediaStatus: string;
  photoCount: number;
  mediaUpdatedAt: string;
  photos?: unknown[];
}
