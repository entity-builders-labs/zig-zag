import { Prisma } from '@prisma/client';

export interface PlannedExperienceForSnapshot {
  dayNumber: number;
  order: number;
  startTime?: Date;
  duration: number;
  notes?: string;
  travelFromPrevious?: unknown;
}

export interface ExperienceComponentForSnapshot {
  geoEntityId: string;
  order: number | null;
  role: string | null;
  required: boolean;
  geoEntity: {
    name: string;
    latitude: number | null;
    longitude: number | null;
    geometry: unknown;
  };
}

export interface ExperienceEntityForSnapshot {
  id: string;
  components: ExperienceComponentForSnapshot[];
}

/**
 * Pure mapper from the solver's own planned-experience shape + the resolved
 * Experience entity to exactly the `data` object
 * `tx.tourExperience.create({ data })` needs. Extracted so the two real bugs
 * fixed here (order fabrication, discarded travelFromPrevious) are covered
 * by fast, dependency-free tests instead of only reachable through the full
 * generation service.
 *
 * Component `order` is passed through as-is (`component.order`, no `??`
 * fallback) — verified live this session that fabricating `index + 1` when
 * `order` is genuinely `null` (no real intrinsic-order evidence) permanently
 * destroys that "unordered" signal in the frozen Tour snapshot.
 */
export function buildTourExperienceCreateData(
  tourId: string,
  selected: PlannedExperienceForSnapshot,
  experience: ExperienceEntityForSnapshot,
): Prisma.TourExperienceUncheckedCreateInput {
  return {
    tourId,
    experienceId: experience.id,
    dayNumber: selected.dayNumber,
    order: selected.order,
    startTime: selected.startTime,
    duration: selected.duration,
    notes: selected.notes,
    travelFromPrevious: (selected.travelFromPrevious ??
      null) as Prisma.InputJsonValue | null,
    components: {
      create: experience.components.map((component) => ({
        geoEntityId: component.geoEntityId,
        order: component.order,
        role: component.role,
        required: component.required,
        name: component.geoEntity.name,
        latitude: component.geoEntity.latitude,
        longitude: component.geoEntity.longitude,
        geometry: component.geoEntity.geometry as
          | Prisma.InputJsonValue
          | undefined,
      })),
    },
  };
}
