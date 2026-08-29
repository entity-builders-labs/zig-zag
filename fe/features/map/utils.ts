import { Region } from './types';

// Computes a region that fits every given coordinate, with some padding so
// pins near the edge aren't clipped. Falls back to a fixed-zoom region
// around a single point when there's nothing (or only one point) to fit.
export function getRegionForCoordinates(
  coordinates: { latitude: number; longitude: number }[],
  fallback?: { latitude: number; longitude: number }
): Region | undefined {
  if (coordinates.length === 0) {
    return fallback ? { ...fallback, latitudeDelta: 0.02, longitudeDelta: 0.02 } : undefined;
  }

  const lats = coordinates.map((c) => c.latitude);
  const lngs = coordinates.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const PADDING_FACTOR = 1.4;
  const MIN_DELTA = 0.01;

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * PADDING_FACTOR, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * PADDING_FACTOR, MIN_DELTA),
  };
}

export function getCategoryEmoji(category?: string, name?: string): string {
  const c = (category || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (c.includes('cafe') || c.includes('café') || c.includes('bar') || n.includes('café') || n.includes('bar ')) return '☕';
  if (c.includes('restauran') || c.includes('gastronom') || c.includes('comida') || c.includes('food')) return '🍽️';
  if (c.includes('museo') || c.includes('museum') || c.includes('art') || c.includes('galería')) return '🎨';
  if (c.includes('teatro') || c.includes('theater') || c.includes('ópera') || c.includes('opera') || c.includes('show')) return '🎭';
  if (c.includes('monument') || c.includes('cultur') || c.includes('hist') || c.includes('palacio') || c.includes('iglesia')) return '🏛️';
  if (c.includes('parque') || c.includes('park') || c.includes('plaza') || c.includes('jard') || c.includes('natur')) return '🌳';
  if (c.includes('librería') || c.includes('book') || c.includes('biblioteca')) return '📚';
  if (c.includes('walk') || c.includes('camin') || c.includes('barrio')) return '🚶';
  return '📍';
}

export function createSvgMarkerUrl(params: {
  order?: number;
  icon?: string;
  category?: string;
  title?: string;
  color?: string;
  selected?: boolean;
}): string {
  const bgColor = params.selected ? '#0F172A' : (params.color || '#EA580C');
  const borderColor = '#FFFFFF';
  const emoji = params.icon || (params.order != null ? null : getCategoryEmoji(params.category, params.title));
  
  const content = params.order != null
    ? `<text x="19" y="22" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="14" fill="#FFFFFF">${params.order}</text>`
    : `<text x="19" y="20" text-anchor="middle" dominant-baseline="central" font-size="15">${emoji || '★'}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46"><defs><filter id="s" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.35"/></filter></defs><path d="M19 1 C8.5 1 1 8.5 1 19 C1 28.5 14 39.5 18 43.5 C18.5 44 19.5 44 20 43.5 C24 39.5 37 28.5 37 19 C37 8.5 29.5 1 19 1 Z" fill="${bgColor}" stroke="${borderColor}" stroke-width="2.5" filter="url(#s)"/>${content}</svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`;
}
