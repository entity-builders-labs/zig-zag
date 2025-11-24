import { BadgeData } from './types';

export const getImage = (photos: any) => {
  if (Array.isArray(photos) && photos.length > 0) {
    const first = photos[0];
    return typeof first === 'string'
      ? first
      : first?.url || first?.photo_reference;
  }
  if (typeof photos === 'string') {
    return photos;
  }
  return 'https://placehold.co/500x800.png'; // fallback
};

export const getBadges = (activity: any): BadgeData[] => {
  if (!activity) return [];
  const badges: BadgeData[] = [];
  if (activity.price) {
    badges.push({ text: `$${activity.price}`, action: 'info' });
  }
  if (activity.type) {
    badges.push({ text: activity.type, action: 'success' });
  }
  return badges;
};
