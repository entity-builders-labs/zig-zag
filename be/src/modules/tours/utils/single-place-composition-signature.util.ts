import { createHash } from 'node:crypto';

/**
 * Stable identity for the canonical one-place composition. Mutable knowledge
 * such as duration, opening hours, provenance, and policy versions is
 * deliberately excluded.
 */
export function singlePlaceCompositionSignature(geoEntityId: string): string {
  if (!geoEntityId.trim()) {
    throw new Error('A GeoEntity id is required for a place composition');
  }
  const constitutiveComponents = [
    { geoEntityId, participation: 'VISIT' as const },
  ];
  const digest = createHash('sha256')
    .update(JSON.stringify({ version: 1, components: constitutiveComponents }))
    .digest('hex');
  return `v1:${digest}`;
}
