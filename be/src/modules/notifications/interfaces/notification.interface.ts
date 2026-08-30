export interface TourNotificationPayload {
  tourId: string;
  userId?: string;
  status: string;
  progress?: number;
  message?: string;
  data?: any;
}

export interface ActivityMediaNotificationPayload {
  activityId: string;
  mediaStatus: string;
  photoCount: number;
}
