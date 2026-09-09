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
      canonicalName: input.canonicalName,
      description: input.description,
      status: input.status ?? 'VERIFIED',
      qualityScore: input.qualityScore ?? 0.8,
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
