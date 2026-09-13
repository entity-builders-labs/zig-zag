import { randomUUID } from 'crypto';
import { PrismaService } from 'src/core/database/prisma.service';

/** A "known" opening-hours block that is open every minute of every weekday. */
export const ALWAYS_OPEN = {
  status: 'known',
  rangesByWeekday: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      weekday,
      [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    ]),
  ),
};

export interface SeedExperienceInput {
  /**
   * Explicit id override (default: Prisma's `@default(uuid())`). Used by
   * scale-regression tests that need deterministic control over
   * `ORDER BY ... id ASC` / a global `id`-ordered scan boundary, e.g.
   * forcing a target row to sort after every random-UUID filler row.
   */
  id?: string;
  canonicalName: string;
  description?: string;
  themes?: string[];
  traits?: string[];
  intents?: string[];
  latitude: number;
  longitude: number;
  durationMinutes?: number;
  qualityScore?: number;
  source?: string;
  status?: 'VERIFIED' | 'PENDING' | 'REJECTED';
  openingHours?: unknown;
  /** Extra ExperienceComponent geo entities (a multi-component walk/route). */
  extraComponents?: Array<{
    name: string;
    latitude: number;
    longitude: number;
  }>;
}

/**
 * Seeds one VERIFIED Experience with a primary PLACE GeoEntity component (plus
 * optional extra components), mirroring what the catalog persists. Enough for
 * `findVerifiedWithin`, ranking, normalization and the solver.
 */
export async function seedVerifiedExperience(
  prisma: PrismaService,
  input: SeedExperienceInput,
): Promise<string> {
  const metadata = {
    source: input.source ?? 'seed',
    themes: input.themes ?? [],
    traits: input.traits ?? [],
    intents: input.intents ?? [],
  };
  const primary = await prisma.geoEntity.create({
    data: {
      name: input.canonicalName,
      kind: 'PLACE',
      latitude: input.latitude,
      longitude: input.longitude,
    },
  });
  const experience = await prisma.experience.create({
    data: {
      id: input.id,
      canonicalName: input.canonicalName,
      description: input.description,
      status: input.status ?? 'VERIFIED',
      // Canonical scale is 0..5 (DEFAULT_QUALITY_FLOOR = 3.0,
      // preference-strong-match.util.ts). `0.8` was a stale 0..1-scale
      // placeholder that could be misread as "80% quality" -- it was
      // actually just barely above nothing on the real scale, and either
      // way must never silently pass as a strong facet match. Callers that
      // need a genuinely strong catalog row (e.g. proving sufficiency)
      // MUST pass an explicit qualityScore >= 3.0; this default (2.0,
      // matching seedFillerExperiences' own convention below) is
      // deliberately BELOW the floor for callers that don't care about
      // quality at all.
      qualityScore: input.qualityScore ?? 2.0,
      durationMinutes: input.durationMinutes ?? 90,
      latitude: input.latitude,
      longitude: input.longitude,
      openingHours: (input.openingHours ?? ALWAYS_OPEN) as any,
      metadata,
      components: {
        create: [
          { geoEntityId: primary.id, order: 0, role: 'venue', required: true },
        ],
      },
    },
  });
  for (const [i, extra] of (input.extraComponents ?? []).entries()) {
    const geo = await prisma.geoEntity.create({
      data: {
        name: extra.name,
        kind: 'PLACE',
        latitude: extra.latitude,
        longitude: extra.longitude,
      },
    });
    await prisma.experienceComponent.create({
      data: {
        experienceId: experience.id,
        geoEntityId: geo.id,
        order: i + 1,
        role: 'waypoint',
        required: true,
      },
    });
  }
  for (const key of input.traits ?? []) {
    const dimension = 'general';
    const def = await prisma.traitDefinition.upsert({
      where: { dimension_key: { dimension, key: key.toLowerCase() } },
      update: {},
      create: { dimension, key: key.toLowerCase(), label: key },
    });
    await prisma.experienceTrait
      .create({
        data: { experienceId: experience.id, traitDefinitionId: def.id },
      })
      .catch((): undefined => undefined);
  }
  return experience.id;
}

export interface SeedTourInput {
  destinationLabel: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  days?: number;
  interests?: string[];
  intents?: string[];
  additionalPreferences?: string;
  startDates?: string[];
}

/** Seeds a Tour row with a canonical (contractVersion 1) generationRequest so
 *  `ExperienceGenerationService.generateTourExperiences` can consume it. */
export async function seedTour(
  prisma: PrismaService,
  input: SeedTourInput,
): Promise<string> {
  const days = input.days ?? 2;
  const startDates = input.startDates ?? ['2026-09-07T00:00:00.000Z'];
  const request = {
    contractVersion: 1 as const,
    destination: {
      label: input.destinationLabel,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters ?? 15000,
      scaleHint: 'settlement',
    },
    days,
    budgetLevel: 'medium',
    groupType: 'solo',
    intent: {
      interests: input.interests ?? ['history'],
      intents: input.intents ?? ['visit'],
      explorationStyle: 'balanced',
      additionalPreferences: input.additionalPreferences ?? '',
    },
    mobility: {
      allowedTransportationModes: ['walking', 'public_transport'],
      maxWalkingDistancePerDayMeters: 6000,
      maxContinuousWalkingDistanceMeters: 2500,
      travelPace: 'moderate',
      accessibilityNeeds: [] as string[],
    },
    dietaryRestrictions: [] as string[],
    startDates,
    includeExistingExperiences: true,
    skipImageGeneration: true,
    excludeTours: [] as string[],
    categories: [] as string[],
  };
  const tour = await prisma.tour.create({
    data: {
      name: `Integration Tour · ${input.destinationLabel}`,
      prompt: `${input.destinationLabel} ${(input.interests ?? []).join(' ')}`,
      totalDays: days,
      startDates: startDates.map((d) => new Date(d)),
      metadata: JSON.parse(
        JSON.stringify({
          generationRequest: request,
          generationStatus: 'pending',
        }),
      ),
    },
  });
  return tour.id;
}

export interface BulkSeedFillerInput {
  count: number;
  /** Center used to compute each filler's jittered/scattered coordinates. */
  latitude: number;
  longitude: number;
  /**
   * When set, each filler is scattered uniformly within +/- this many
   * degrees of the center (used for "unrelated rows, some outside the
   * query radius" scale regressions). When omitted, fillers are placed in
   * a tight, deterministic jitter (~tens of meters) around the center so
   * they are all closer than a real target placed farther away.
   */
  scatterDegrees?: number;
  themes?: string[];
  qualityScore?: number;
}

/**
 * Bulk-seeds `count` VERIFIED, single-component filler Experiences via a
 * few parameterized `INSERT ... SELECT ... FROM unnest(...)` statements
 * instead of `count` serial round trips -- needed for the A6.1 scale
 * regression tests (2000+ rows) to run in reasonable time. IDs are
 * generated in JS and correlated by array position across the two inserts,
 * so no data-modifying-CTE row-correlation trickery is needed.
 */
export async function bulkSeedFillerExperiences(
  prisma: PrismaService,
  input: BulkSeedFillerInput,
): Promise<void> {
  const { count, latitude, longitude, scatterDegrees } = input;
  if (count <= 0) return;

  const metadata = JSON.stringify({
    source: 'seed',
    themes: input.themes ?? ['nightlife'],
    traits: [],
    intents: [],
  });
  const qualityScore = input.qualityScore ?? 2.0;

  const geoIds: string[] = [];
  const expIds: string[] = [];
  const lats: number[] = [];
  const lngs: number[] = [];

  for (let i = 0; i < count; i++) {
    geoIds.push(randomUUID());
    expIds.push(randomUUID());
    if (scatterDegrees) {
      lats.push(latitude + (Math.random() * 2 - 1) * scatterDegrees);
      lngs.push(longitude + (Math.random() * 2 - 1) * scatterDegrees);
    } else {
      // Deterministic, tight (~tens of meters) jitter -- distinct
      // coordinates without a DB round trip per row, and strictly closer
      // to the center than a real target placed further away on purpose.
      const latOffset = ((i * 37) % 200) - 100;
      const lngOffset = ((i * 53) % 200) - 100;
      lats.push(latitude + latOffset * 0.0000015);
      lngs.push(longitude + lngOffset * 0.0000015);
    }
  }

  await prisma.$executeRaw`
    INSERT INTO "geo_entity" (id, name, kind, latitude, longitude, "createdAt", "updatedAt")
    SELECT g.id, 'Filler GeoEntity', 'PLACE'::"GeoEntityKind", g.lat, g.lng, now(), now()
    FROM unnest(${geoIds}::text[], ${lats}::float8[], ${lngs}::float8[]) AS g(id, lat, lng)
  `;

  await prisma.$executeRaw`
    INSERT INTO "experience" (id, "canonicalName", status, "qualityScore", "durationMinutes", metadata, "createdAt", "updatedAt")
    SELECT e.id, 'Filler Experience', 'VERIFIED'::"ExperienceStatus", ${qualityScore}::float8, 90, ${metadata}::jsonb, now(), now()
    FROM unnest(${expIds}::text[]) AS e(id)
  `;

  await prisma.$executeRaw`
    INSERT INTO "experience_component" (id, "experienceId", "geoEntityId", "order", role, required)
    SELECT gen_random_uuid()::text, pair.eid, pair.gid, 0, 'venue', true
    FROM unnest(${expIds}::text[], ${geoIds}::text[]) AS pair(eid, gid)
  `;
}
