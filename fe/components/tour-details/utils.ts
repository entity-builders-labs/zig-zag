import { BadgeData } from './types';

const FALLBACK_TRAVEL_IMAGES = [
  'https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1513584684374-8bab748fbf90?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518684079-3c830dcef090?q=80&w=800&auto=format&fit=crop',
];

export const getImage = (photos: any, index: number = 0) => {
  if (Array.isArray(photos) && photos.length > 0) {
    const first = photos[0];
    const url = typeof first === 'string'
      ? first
      : first?.url || first?.photo_reference;
    if (url && !url.includes('placehold.co') && !url.includes('dummyimage')) {
      return url;
    }
  }
  if (typeof photos === 'string' && photos.trim() !== '' && !photos.includes('placehold.co') && !photos.includes('dummyimage')) {
    return photos;
  }
  return FALLBACK_TRAVEL_IMAGES[index % FALLBACK_TRAVEL_IMAGES.length];
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
