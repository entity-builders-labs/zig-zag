export interface ActivityForPrompt {
  id: string;
  name: string;
  type?: string | null;
  description?: string | null;
  latitude: number;
  longitude: number;
  duration?: number | null;
  rating?: number | null;
  ratingCount?: number | null;
  priceLevel?: number | null;
  openingHours?: { weekdayText?: string[] } | null;
}

/** One line of the "Available activities" list sent to the AI — every signal
 * here is real data the model can weigh, not something it has to guess at. */
export function formatActivityForPrompt(act: ActivityForPrompt): string {
  const parts = [
    `id: ${act.id}`,
    `${act.name} (${act.type || 'Activity'})`,
    (act.description || 'No description').substring(0, 100),
    `Location: ${act.latitude}, ${act.longitude}`,
    `Duration: ${act.duration || 'Unknown'} minutes`,
  ];

  if (act.rating != null) {
    const reviews =
      act.ratingCount != null ? ` (${act.ratingCount} reviews)` : '';
    parts.push(`Rating: ${act.rating}/5${reviews}`);
  }

  if (act.priceLevel != null) {
    parts.push(`Price level: ${act.priceLevel}/5`);
  }

  const weekdayText = act.openingHours?.weekdayText;
  if (weekdayText?.length) {
    parts.push(`Opening hours: ${weekdayText.join('; ')}`);
  }

  return parts.join(' - ');
}
