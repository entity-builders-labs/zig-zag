export const notificationChannel = {
  tour: (tourId: string) => `tour:${tourId}`,
  activity: (activityId: string) => `activity:${activityId}`,
} as const;
