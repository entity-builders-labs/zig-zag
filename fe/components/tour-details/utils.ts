import { BadgeData } from './types';

export const CATEGORY_FALLBACK_IMAGES: Record<string, string[]> = {
  tango: [
    'https://images.unsplash.com/photo-1545959570-a9438fa1997e?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=1000&auto=format&fit=crop',
  ],
  cultural: [
    'https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1518998053901-5348d3961a04?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?q=80&w=1000&auto=format&fit=crop',
  ],
  architecture: [
    'https://images.unsplash.com/photo-1513584684374-8bab748fbf90?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1541971875076-8f970d573be6?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1000&auto=format&fit=crop',
  ],
  food: [
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=1000&auto=format&fit=crop',
  ],
  outdoor: [
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?q=80&w=1000&auto=format&fit=crop',
  ],
  default: [
    'https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1513584684374-8bab748fbf90?q=80&w=1000&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1518684079-3c830dcef090?q=80&w=1000&auto=format&fit=crop',
  ],
};

export const getImage = (photos: any, index: number = 0, category?: string) => {
  const gallery = getPhotoGallery(photos, category);
  return gallery[index % gallery.length] || CATEGORY_FALLBACK_IMAGES.default[0];
};

export const getPhotoGallery = (photos: any, category?: string): string[] => {
  const urls: string[] = [];

  if (Array.isArray(photos)) {
    for (const p of photos) {
      const url = typeof p === 'string' ? p : p?.url || p?.photo_reference;
      if (url && typeof url === 'string' && url.trim() !== '' && !url.includes('placehold.co') && !url.includes('dummyimage')) {
        urls.push(url);
      }
    }
  } else if (typeof photos === 'string' && photos.trim() !== '' && !photos.includes('placehold.co') && !photos.includes('dummyimage')) {
    urls.push(photos);
  }

  // If we have authentic photos from Wikimedia/Google Places/Wikidata, return them directly
  if (urls.length > 0) {
    return urls;
  }

  // Normalize category key for pure fallback when place has 0 photos
  const catKey = (category || '').toLowerCase();
  let fallbacks = CATEGORY_FALLBACK_IMAGES.default;
  if (catKey.includes('tango') || catKey.includes('dance') || catKey.includes('baile')) {
    fallbacks = CATEGORY_FALLBACK_IMAGES.tango;
  } else if (catKey.includes('food') || catKey.includes('gastronom') || catKey.includes('bar') || catKey.includes('cafe')) {
    fallbacks = CATEGORY_FALLBACK_IMAGES.food;
  } else if (catKey.includes('arch') || catKey.includes('monument') || catKey.includes('historic')) {
    fallbacks = CATEGORY_FALLBACK_IMAGES.architecture;
  } else if (catKey.includes('cultur') || catKey.includes('museum') || catKey.includes('museo') || catKey.includes('art')) {
    fallbacks = CATEGORY_FALLBACK_IMAGES.cultural;
  } else if (catKey.includes('park') || catKey.includes('nature') || catKey.includes('outdoor')) {
    fallbacks = CATEGORY_FALLBACK_IMAGES.outdoor;
  }

  return fallbacks;
};

export const getHighlights = (experience: any): string[] => {
  if (!experience) return [];

  // 1. From metadata.highlights
  if (Array.isArray(experience.metadata?.highlights) && experience.metadata.highlights.length > 0) {
    return experience.metadata.highlights;
  }

  // 2. From metadata.tags
  if (Array.isArray(experience.metadata?.tags) && experience.metadata.tags.length > 0) {
    return experience.metadata.tags.slice(0, 4);
  }

  // 3. Derive from name / description / type
  const highlights: string[] = [];
  const name = (experience.canonicalName || experience.name || '').toLowerCase();
  const desc = (experience.description || '').toLowerCase();
  const type = (experience.type || experience.traits?.map((trait: any) => trait.value).join(' ') || '').toLowerCase();

  if (name.includes('zanjón') || desc.includes('túnel') || desc.includes('subterráneo')) {
    highlights.push('🏛️ Túneles subterráneos coloniales del siglo XVIII');
    highlights.push('🔍 Restos arqueológicos fundacionales');
    highlights.push('🗣️ Visita guiada histórica');
  } else if (name.includes('sur') || name.includes('almacén') || desc.includes('tango') || type.includes('tango')) {
    highlights.push('💃 Espectáculo de tango íntimo y auténtico');
    highlights.push('🍷 Carta selecta de vinos y gastronomía típica');
    highlights.push('🎻 Música en vivo con bandoneón');
  } else if (name.includes('dorrego') || name.includes('plaza')) {
    highlights.push('🌳 Corazón bohemio y feria de antigüedades');
    highlights.push('☕ Bares notables y mesas al aire libre');
    highlights.push('🎨 Artistas callejeros y parejas de tango');
  } else if (name.includes('moderno') || name.includes('museo') || type.includes('cultural')) {
    highlights.push('🎨 Colecciones vanguardistas y arte moderno');
    highlights.push('🏛️ Arquitectura industrial recuperada');
    highlights.push('📚 Tienda de diseño y café cultural');
  } else {
    if (experience.rating && experience.rating >= 4.5) {
      highlights.push(`⭐ Excelencia calificada (${experience.rating.toFixed(1)} / 5)`);
    }
    if (experience.priceLevel === 0 || experience.price === 0) {
      highlights.push('🎟️ Entrada libre y gratuita');
    }
    highlights.push('📍 Punto icónico imperdible en la zona');
    highlights.push('📸 Excelente oportunidad para fotografías');
  }

  return highlights;
};

export const getCuratorTip = (experience: any): string => {
  if (experience?.metadata?.curatorTip) return experience.metadata.curatorTip;
  if (experience?.metadata?.insiderTip) return experience.metadata.insiderTip;
  if (experience?.notes) return experience.notes;

  const name = (experience?.canonicalName || experience?.name || '').toLowerCase();
  if (name.includes('zanjón')) {
    return 'Llegá 15 minutos antes del turno de visita guiada para recorrer la galería de fotos históricas en la recepción.';
  }
  if (name.includes('sur') || name.includes('almacén')) {
    return 'Reservá con anticipación para conseguir mesa en primera fila cerca del escenario y pedí una copa de Malbec para acompañar el show.';
  }
  if (name.includes('dorrego')) {
    return 'Los domingos se llena de vida con la feria histórica. El mejor momento para fotos es entre las 11:00 y las 14:00.';
  }
  if (name.includes('moderno')) {
    return 'Consultá en recepción por la audioguía gratuita en tu celular; explica el contexto de cada sala en 10 minutos.';
  }

  return 'Ideal para visitar con calzado cómodo y cámara de fotos. Consultá los horarios de menor concurrencia al mediodía.';
};

export const getPriceLevelLabel = (priceLevel?: number | null, price?: number | null): string => {
  if (priceLevel === 0 || price === 0) return '🎟️ Gratis / Acceso Libre';
  if (priceLevel === 1) return '💲 Económico ($)';
  if (priceLevel === 2) return '💲💲 Moderado ($$)';
  if (priceLevel === 3) return '💲💲💲 Exclusivo ($$$)';
  if (priceLevel === 4) return '💲💲💲💲 Premium ($$$$)';
  if (price && price > 0) return `$${price}`;
  return '💲 Tarifa estándar';
};

export interface FormattedOpeningHours {
  isOpenNow: boolean;
  todayScheduleText: string;
  scheduleRows: { day: string; hours: string; isToday: boolean }[];
}

export const getOpeningHoursFormatted = (openingHours: any): FormattedOpeningHours => {
  const daysMap = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const todayDayIndex = new Date().getDay();
  const todayName = daysMap[todayDayIndex];

  let scheduleRows: { day: string; hours: string; isToday: boolean }[] = [];

  if (openingHours?.weekdayDescriptions && Array.isArray(openingHours.weekdayDescriptions)) {
    scheduleRows = openingHours.weekdayDescriptions.map((desc: string) => {
      const parts = desc.split(': ');
      const day = parts[0] || '';
      const hours = parts.slice(1).join(': ') || 'Consultar';
      const isToday = day.toLowerCase().includes(todayName.toLowerCase());
      return { day, hours, isToday };
    });
  } else if (typeof openingHours === 'object' && openingHours !== null) {
    scheduleRows = Object.entries(openingHours).map(([key, val]) => {
      const isToday = key.toLowerCase().includes(todayName.toLowerCase());
      return { day: key, hours: String(val), isToday };
    });
  }

  if (scheduleRows.length === 0) {
    scheduleRows = [
      { day: 'Lunes a Viernes', hours: '10:00 - 19:00', isToday: todayDayIndex >= 1 && todayDayIndex <= 5 },
      { day: 'Sábado y Domingo', hours: '11:00 - 20:00', isToday: todayDayIndex === 0 || todayDayIndex === 6 }
    ];
  }

  const todayRow = scheduleRows.find(r => r.isToday) || scheduleRows[0];
  const todayScheduleText = todayRow ? `${todayRow.hours}` : 'Abierto hoy';
  const isOpenNow = !todayScheduleText.toLowerCase().includes('cerrado');

  return {
    isOpenNow,
    todayScheduleText,
    scheduleRows
  };
};

export const getNavigationUrls = (lat?: number, lng?: number, address?: string, name?: string) => {
  const queryStr = encodeURIComponent(`${name || ''} ${address || ''}`.trim());
  const hasCoords = lat !== undefined && lat !== null && lng !== undefined && lng !== null && lat !== 0 && lng !== 0;

  return {
    google: hasCoords
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${queryStr}`,
    apple: hasCoords
      ? `https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name || '')}`
      : `https://maps.apple.com/?q=${queryStr}`,
    waze: hasCoords
      ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
      : `https://waze.com/ul?q=${queryStr}`,
  };
};

export const getBadges = (experience: any): BadgeData[] => {
  if (!experience) return [];
  const badges: BadgeData[] = [];
  if (experience.priceLevel !== undefined && experience.priceLevel !== null) {
    const priceText = experience.priceLevel === 0 ? 'Gratis' : '$'.repeat(experience.priceLevel);
    badges.push({ text: priceText, action: 'info' });
  } else if (experience.price) {
    badges.push({ text: `$${experience.price}`, action: 'info' });
  }
  const traitLabel = experience.traits?.map((trait: any) => trait.value).filter(Boolean).slice(0, 2).join(' · ');
  if (experience.type || traitLabel) {
    badges.push({ text: experience.type || traitLabel, action: 'success' });
  }
  return badges;
};
