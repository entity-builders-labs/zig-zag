export const notificationChannel = {
  tour: (tourId: string) => `tour:${tourId}`,
  experience: (experienceId: string) => `experience:${experienceId}`,
} as const;
