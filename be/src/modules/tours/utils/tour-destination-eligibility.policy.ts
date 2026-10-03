import { GeoEntityKind } from '@prisma/client';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { ExperienceDestinationRelation } from '../interfaces/experience-geographic-scope.interface';
import { evaluateExperienceDestinationRelation } from './destination-compatibility.policy';

/**
 * Tour eligibility of a catalog Experience retrieved through the trip
 * DESTINATION window (spec 2026-10-02 Part II §P2-9, product decision PD1).
 *
 * Catalog validity is not trip-relative: a verified regional Experience
 * stays in the catalog whatever its relation to this trip. But without
 * routing-backed travel feasibility, an Experience that leaves the
 * destination (EXTENDS_BEYOND / OUTSIDE) is never scheduled merely because
 * a destination-window retrieval (a bounding-box circle, wider than the
 * polygon) happened to return it, and an UNKNOWN relation is never read as
 * WITHIN. An Experience reached through an EXPLICIT request scope (a
 * user-named regional anchor, a named venue) is retrieved by that scope's
 * own path, not by this gate.
 */

interface CatalogRowComponent {
  role?: string | null;
  geoEntity?: {
    kind?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    geometry?: unknown;
  } | null;
}

export function catalogRowDestinationRelation(
  row: { components?: CatalogRowComponent[] | null },
  destination: GeographicScope,
): ExperienceDestinationRelation {
  return evaluateExperienceDestinationRelation(
    (row.components ?? []).map((component, index) => ({
      hintKey: String(index),
      role: component.role ?? 'venue',
      ...(component.geoEntity?.kind
        ? { kind: component.geoEntity.kind as GeoEntityKind }
        : {}),
      latitude: component.geoEntity?.latitude,
      longitude: component.geoEntity?.longitude,
      geometry: component.geoEntity?.geometry ?? undefined,
    })),
    destination,
  );
}

export function isTourEligibleForDestinationRequest(
  row: { components?: CatalogRowComponent[] | null },
  destination: GeographicScope,
): boolean {
  return (
    catalogRowDestinationRelation(row, destination).relation ===
    'WITHIN_DESTINATION'
  );
}
