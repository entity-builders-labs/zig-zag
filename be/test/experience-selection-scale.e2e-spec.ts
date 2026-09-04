import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ExperienceStatus, GeoEntityKind, MediaStatus } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { OutboxPublisherService } from '../src/modules/outbox/services/outbox-publisher.service';
import { GeoapifyTravelEstimateProvider } from '../src/modules/tours/services/geoapify-travel-estimate.provider';
import { TransportationMode } from '../src/modules/tours/interfaces/tour-generation.interface';
import { LangChainService } from '../src/shared/ai/langchain.service';
import { AiEmbeddingService } from '../src/shared/ai/services/ai-embedding.service';

jest.setTimeout(240_000);

const CATALOG_SIZE = 320;
const EMBEDDING_DIMENSIONS = 256;
const EMBEDDING_IDENTITY = {
  provider: 'e2e',
  model: 'deterministic-scale-v2',
  dimensions: EMBEDDING_DIMENSIONS,
  documentVersion: 2,
};
const positiveVector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1);
const negativeVector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => -1);
const alwaysOpen = {
  status: 'known',
  rangesByWeekday: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      weekday,
      [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    ]),
  ),
};
const closedDuringPlanningWindow = {
  status: 'known',
  rangesByWeekday: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      weekday,
      [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
    ]),
  ),
};

type ScenarioKey =
  | 'culture-art-tango'
  | 'vegan-budget-duration'
  | 'accessible-short-open'
  | 'mixed-age-family'
  | 'long-tail'
  | 'explicit-relaxation';

interface ScenarioExperience {
  oracleClass: string;
  canonicalName: string;
  description: string;
  themes: string[];
  traits: string[];
  intents: string[];
  durationMinutes: number;
  price: number;
  qualityScore: number;
  semanticTier: 'positive' | 'negative';
  openingHours?: any;
  budgetLevel?: string;
  groupType?: string;
  latitudeOffset?: number;
  longitudeOffset?: number;
}

interface SeededRow {
  id: string;
  value: ScenarioExperience;
  latitude: number;
  longitude: number;
}

interface ScenarioDefinition {
  key: ScenarioKey;
  title: string;
  interpretation: Record<string, unknown>;
  request: Record<string, unknown>;
  expectedSelectedClass: string;
  minimumExpectedSelected: number;
  buildExperience(index: number): ScenarioExperience;
  assertTrace?: (tour: any, rows: SeededRow[]) => void;
}

function normalizedIntent(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    preferredThemes: [] as string[],
    preferredTraits: [] as string[],
    preferredIntents: [] as string[],
    excludedThemes: [] as string[],
    excludedTraits: [] as string[],
    hardExclusions: [] as string[],
    softConstraints: [] as string[],
    ambiguities: [] as string[],
    dietaryPreferences: [] as string[],
    accessibilityPreferences: [] as string[],
    budgetPreferences: [] as string[],
    groupPreferences: [] as string[],
    positiveSemanticQuery: '',
    notes: ['CP8 deterministic scale acceptance'],
    ...overrides,
  };
}

function baseRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    destination: {
      label: 'Obelisco, Buenos Aires',
      latitude: -34.6037,
      longitude: -58.3816,
      radiusMeters: 5000,
      scaleHint: 'specific_point',
    },
    days: 1,
    budgetLevel: 'medium',
    groupType: 'friends',
    intent: {
      interests: [] as string[],
      intents: [] as string[],
      explorationStyle: 'balanced',
      additionalPreferences: '',
    },
    mobility: {
      allowedTransportationModes: ['walking'],
      maxWalkingDistancePerDayMeters: 12000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: 'moderate',
      accessibilityNeeds: [] as string[],
    },
    dietaryRestrictions: [] as string[],
    startDates: ['2026-09-07'],
    includeExistingExperiences: true,
    skipImageGeneration: true,
    excludeTours: [] as string[],
    categories: [] as string[],
    ...overrides,
  };
}

function experience(
  oracleClass: string,
  overrides: Partial<ScenarioExperience>,
): ScenarioExperience {
  return {
    oracleClass,
    canonicalName: oracleClass,
    description: oracleClass,
    themes: ['general'],
    traits: ['general'],
    intents: ['visit'],
    durationMinutes: 60,
    price: 20,
    qualityScore: 3.5,
    semanticTier: 'negative',
    openingHours: alwaysOpen,
    ...overrides,
  };
}

function traceStep(tour: any, stage: string): any {
  return tour.metadata.generationTrace.steps.find(
    (step: any) => step.stage === stage,
  );
}

const scenarios: ScenarioDefinition[] = [
  {
    key: 'culture-art-tango',
    title: 'culture + art + tango + walking, excluding religion',
    interpretation: normalizedIntent({
      preferredThemes: ['culture', 'art', 'tango'],
      preferredIntents: ['walk'],
      excludedThemes: ['religion'],
      hardExclusions: ['religion'],
      positiveSemanticQuery: 'culture art tango walking Buenos Aires',
    }),
    request: baseRequest({
      intent: {
        interests: ['culture', 'art', 'tango'],
        intents: ['walk'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Quiero cultura, arte y tango caminando. No quiero iglesias ni experiencias religiosas.',
      },
    }),
    expectedSelectedClass: 'ideal_culture_walk',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 15) {
        return experience('ideal_culture_walk', {
          canonicalName: `Paseo cultural de arte y tango ${index}`,
          description: 'Caminata cultural con arte, tango y patrimonio secular.',
          themes: ['culture', 'art', 'tango'],
          traits: ['walking', 'local culture'],
          intents: ['walk'],
          semanticTier: 'positive',
          qualityScore: 4.4,
        });
      }
      if (index < 45) {
        return experience('religious_false_friend', {
          canonicalName: `Tango y arte en catedral ${index}`,
          description: 'Tango y arte dentro de una iglesia y catedral religiosa.',
          themes: ['culture', 'art', 'tango', 'religion'],
          traits: ['walking'],
          intents: ['walk'],
          semanticTier: 'positive',
          qualityScore: 4.9,
        });
      }
      return experience(index % 5 ? 'distractor' : 'tango_only', {
        canonicalName: `Distractor cultural ${index}`,
        description: 'Actividad parcial o irrelevante para el pedido.',
        themes: index % 5 ? ['shopping'] : ['tango'],
      });
    },
    assertTrace(tour) {
      expect(
        traceStep(tour, 'candidate_pool').candidates.some((candidate: any) =>
          candidate.id.includes('religious_false_friend'),
        ),
      ).toBe(false);
    },
  },
  {
    key: 'vegan-budget-duration',
    title: 'vegan gastronomy + low budget + duration feasibility',
    interpretation: normalizedIntent({
      preferredThemes: ['gastronomy'],
      preferredTraits: ['vegan'],
      dietaryPreferences: ['vegan'],
      budgetPreferences: ['low budget'],
      hardExclusions: ['non-vegan food'],
      positiveSemanticQuery: 'vegan affordable gastronomy Buenos Aires',
    }),
    request: baseRequest({
      budgetLevel: 'low',
      dietaryRestrictions: ['vegan'],
      intent: {
        interests: ['gastronomy'],
        intents: ['food'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Comida vegana económica y experiencias cortas, sin carne.',
      },
    }),
    expectedSelectedClass: 'ideal_vegan_budget',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 15) {
        return experience('ideal_vegan_budget', {
          canonicalName: `Bocados veganos económicos ${index}`,
          description: 'Gastronomía vegana plant based, económica y compacta.',
          themes: ['gastronomy'],
          traits: ['vegan', 'low budget', 'plant based'],
          intents: ['food'],
          durationMinutes: 50,
          price: 8,
          budgetLevel: 'low',
          semanticTier: 'positive',
          qualityScore: 4.8,
        });
      }
      if (index < 39) {
        return experience('vegan_too_long', {
          canonicalName: `Maratón vegana económica ${index}`,
          description: 'Gastronomía vegana económica que ocupa todo el día.',
          themes: ['gastronomy'],
          traits: ['vegan', 'low budget', 'plant based'],
          intents: ['food'],
          durationMinutes: 720,
          price: 8,
          budgetLevel: 'low',
          semanticTier: 'positive',
          qualityScore: 3.4,
        });
      }
      if (index < 71) {
        return experience('vegan_expensive', {
          canonicalName: `Vegano premium ${index}`,
          description: 'Menú vegano premium de precio alto.',
          themes: ['gastronomy'],
          traits: ['vegan', 'premium'],
          intents: ['food'],
          price: 180,
          budgetLevel: 'high',
          qualityScore: 4.2,
        });
      }
      if (index < 103) {
        return experience('cheap_non_vegan', {
          canonicalName: `Parrilla económica ${index}`,
          description: 'Parrilla barata con carne, asado, steak y chorizo.',
          themes: ['gastronomy'],
          traits: ['low budget', 'meat'],
          intents: ['food'],
          price: 7,
          budgetLevel: 'low',
        });
      }
      return experience('distractor', {
        canonicalName: `No gastronómica ${index}`,
        themes: ['architecture'],
      });
    },
    assertTrace(tour) {
      const planning = JSON.stringify(traceStep(tour, 'daily_planning'));
      expect(
        planning.includes('DAILY_TIME_CAPACITY_EXCEEDED') ||
          planning.includes('NO_FEASIBLE_DAY'),
      ).toBe(true);
    },
  },
  {
    key: 'accessible-short-open',
    title: 'reduced mobility + short distances + strict opening hours',
    interpretation: normalizedIntent({
      preferredThemes: ['culture'],
      preferredTraits: ['accessibility'],
      accessibilityPreferences: ['accessibility'],
      positiveSemanticQuery: 'accessible short distance culture Buenos Aires',
    }),
    request: baseRequest({
      mobility: {
        allowedTransportationModes: ['walking'],
        maxWalkingDistancePerDayMeters: 2500,
        maxContinuousWalkingDistanceMeters: 600,
        travelPace: 'relaxed',
        accessibilityNeeds: ['accessibility'],
      },
      intent: {
        interests: ['culture'],
        intents: ['visit'],
        explorationStyle: 'balanced',
        additionalPreferences: 'Movilidad reducida: accesible, cerca y abierto.',
      },
    }),
    expectedSelectedClass: 'ideal_accessible_open',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 7) {
        return experience('ideal_accessible_open', {
          canonicalName: `Museo accesible cercano ${index}`,
          description:
            'Visita cultural accessible, step-free, cercana y abierta.',
          themes: ['culture'],
          traits: ['accessibility', 'step-free'],
          intents: ['visit'],
          semanticTier: 'positive',
          qualityScore: 4.8,
          latitudeOffset: (index % 4) * 0.0001,
          longitudeOffset: Math.floor(index / 4) * 0.0001,
        });
      }
      if (index < 15) {
        return experience('accessible_but_closed', {
          canonicalName: `Museo accesible cerrado ${index}`,
          description:
            'Visita cultural accessible, step-free y muy atractiva, pero cerrada durante el recorrido.',
          themes: ['culture'],
          traits: ['accessibility', 'step-free'],
          intents: ['visit'],
          semanticTier: 'positive',
          qualityScore: 5,
          openingHours: closedDuringPlanningWindow,
          latitudeOffset: (index % 4) * 0.0001,
          longitudeOffset: Math.floor(index / 4) * 0.0001,
        });
      }
      if (index < 71) {
        return experience('accessible_far', {
          canonicalName: `Accesible lejana ${index}`,
          description: 'Atracción cultural accesible pero lejana.',
          themes: ['culture'],
          traits: ['accessibility'],
          latitudeOffset: 0.032,
        });
      }
      return experience('distractor', {
        canonicalName: `Sitio con escaleras ${index}`,
        themes: ['culture'],
        traits: ['stairs'],
      });
    },
    assertTrace(tour) {
      const planning = JSON.stringify(traceStep(tour, 'daily_planning'));
      expect(planning).toContain('OPENING_HOURS_INCOMPATIBLE');
    },
  },
  {
    key: 'mixed-age-family',
    title: 'mixed-age family + conflicting adult/child preferences',
    interpretation: normalizedIntent({
      preferredThemes: ['culture', 'interactive'],
      preferredTraits: ['family friendly'],
      groupPreferences: ['family friendly'],
      positiveSemanticQuery: 'family friendly culture interactive mixed ages',
    }),
    request: baseRequest({
      groupType: 'family',
      intent: {
        interests: ['culture', 'interactive'],
        intents: ['visit'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Familia con edades mixtas: cultura para adultos y propuestas interactivas para chicos.',
      },
    }),
    expectedSelectedClass: 'ideal_mixed_family',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 15) {
        return experience('ideal_mixed_family', {
          canonicalName: `Cultura familiar interactiva ${index}`,
          description: 'Family friendly: cultura adulta, niños e interacción.',
          themes: ['culture', 'interactive'],
          traits: ['family friendly', 'kids', 'adults'],
          semanticTier: 'positive',
          qualityScore: 5,
        });
      }
      if (index < 50) {
        return experience('adult_only', {
          canonicalName: `Cultura adultos ${index}`,
          description: 'Experiencia cultural atractiva para adultos, no infantil.',
          themes: ['culture'],
          traits: ['adults'],
          semanticTier: 'positive',
          qualityScore: 4,
        });
      }
      if (index < 85) {
        return experience('kids_only', {
          canonicalName: `Juego infantil ${index}`,
          description:
            'Actividad interactiva para chicos con poco contenido adulto.',
          themes: ['interactive'],
          traits: ['family friendly', 'kids'],
          semanticTier: 'positive',
          qualityScore: 4,
        });
      }
      return experience('distractor', {
        canonicalName: `Nightlife ${index}`,
        themes: ['nightlife'],
        traits: ['adults only'],
      });
    },
    assertTrace(tour) {
      expect(
        traceStep(tour, 'candidate_pool').candidates.every((candidate: any) =>
          candidate.id.includes('ideal_mixed_family'),
        ),
      ).toBe(true);
    },
  },
  {
    key: 'long-tail',
    title: 'long-tail intent inside a mostly irrelevant 320-row catalog',
    interpretation: normalizedIntent({
      preferredThemes: ['hidden history'],
      preferredTraits: ['local'],
      preferredIntents: ['walk'],
      positiveSemanticQuery: 'hidden history local walk obscure Buenos Aires',
    }),
    request: baseRequest({
      intent: {
        interests: ['hidden history'],
        intents: ['walk'],
        explorationStyle: 'local_deep_dive',
        additionalPreferences:
          'Historias barriales poco conocidas y detalles locales.',
      },
    }),
    expectedSelectedClass: 'long_tail_ideal',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 8) {
        return experience('long_tail_ideal', {
          canonicalName: `Historias ocultas ${index}`,
          description:
            'Hidden history local con relatos barriales poco conocidos.',
          themes: ['hidden history'],
          traits: ['local', 'long-tail'],
          intents: ['walk'],
          semanticTier: 'positive',
          qualityScore: 4,
        });
      }
      return experience(
        index < 45 ? 'semantic_false_friend' : 'irrelevant_catalog',
        {
          canonicalName: `Catálogo masivo ${index}`,
          description: 'Oferta general sin afinidad long-tail.',
          themes:
            index < 45
              ? ['history']
              : index % 2
                ? ['shopping']
                : ['sports'],
          durationMinutes: 720,
          qualityScore: index < 45 ? 4.9 : 3.5,
        },
      );
    },
    assertTrace(tour) {
      expect(
        traceStep(tour, 'coverage_analysis').coverageReport
          .analyzedCandidateCount,
      ).toBeGreaterThanOrEqual(250);
      expect(
        tour.metadata.generationTrace.steps.some(
          (step: any) => step.stage === 'discovery',
        ),
      ).toBe(false);
    },
  },
  {
    key: 'explicit-relaxation',
    title:
      'over-constrained request requires deterministic hard-exclusion relaxation',
    interpretation: normalizedIntent({
      preferredThemes: ['tango'],
      preferredIntents: ['performance'],
      hardExclusions: ['religion'],
      positiveSemanticQuery: 'tango Buenos Aires',
    }),
    request: baseRequest({
      intent: {
        interests: ['tango'],
        intents: ['performance'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Quiero tango pero no acepto ningún lugar religioso.',
      },
    }),
    expectedSelectedClass: 'least_bad_after_relaxation',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 15) {
        return experience('least_bad_after_relaxation', {
          canonicalName: `Tango con conflicto religioso ${index}`,
          description:
            'Tango de alta afinidad en un antiguo espacio religioso.',
          themes: ['tango', 'religion'],
          traits: ['performance', 'religious'],
          intents: ['performance'],
          semanticTier: 'positive',
          qualityScore: 4.8,
        });
      }
      return experience('worse_after_relaxation', {
        canonicalName: `Tango religioso inviable ${index}`,
        description:
          'Propuesta religiosa de tango con duración inviable y baja afinidad.',
        themes: ['tango', 'religion'],
        traits: ['performance', 'religious'],
        intents: ['performance'],
        durationMinutes: 720,
        semanticTier: index < 40 ? 'positive' : 'negative',
        qualityScore: 3,
      });
    },
    assertTrace(tour, rows) {
      expect(rows.every((row) => row.value.themes.includes('religion'))).toBe(
        true,
      );
      const preference = traceStep(tour, 'preference_interpretation');
      expect(preference.outputs.intent.hardExclusions).toContain('religion');
      expect(traceStep(tour, 'candidate_pool').candidates).toHaveLength(15);
      expect(
        tour.experiences.every((item: any) =>
          item.experience.metadata.themes.includes('religion'),
        ),
      ).toBe(true);
    },
  },
];

describe('Experience V2 CP8 mandatory selection scenarios at scale', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outboxPublisher: OutboxPublisherService;
  let accessToken: string;
  let activeInterpretation: Record<string, unknown> = scenarios[0].interpretation;

  const fakeLangChain = {
    generateChatResponse: jest.fn(async () =>
      JSON.stringify(activeInterpretation),
    ),
    getProviderMetadata: jest.fn(() => ({
      provider: 'e2e-preference-interpreter',
      model: 'deterministic-json-v2',
    })),
  };
  const fakeEmbeddings = {
    embedQuery: jest.fn(async () => [...positiveVector]),
    embedDocuments: jest.fn(async (texts: string[]): Promise<number[][]> =>
      texts.map(() => [...positiveVector]),
    ),
  };
  const fakeEmbeddingService = {
    ensureInitialized: jest.fn(async (): Promise<void> => undefined),
    getIndexIdentity: jest.fn(() => EMBEDDING_IDENTITY),
    getStatus: jest.fn(() => ({
      status: 'ready',
      identity: EMBEDDING_IDENTITY,
    })),
    getEmbeddings: jest.fn(() => fakeEmbeddings),
  };
  const fakeGeoapifyRouting = {
    isAvailable: jest.fn(() => true),
    estimate: jest.fn(
      async (from: any, to: any, allowedModes: TransportationMode[]) => {
        const dLat = to.centroid.lat - from.centroid.lat;
        const dLng = to.centroid.lng - from.centroid.lng;
        const distanceMeters =
          Math.sqrt(dLat * dLat + dLng * dLng) * 111_000;
        const mode = allowedModes.includes(TransportationMode.WALKING)
          ? TransportationMode.WALKING
          : allowedModes[0];
        const durationMinutes = (distanceMeters / 1000 / 4.8) * 60;
        return {
          mode,
          durationMinutes,
          distanceMeters,
          walkingMinutes:
            mode === TransportationMode.WALKING ? durationMinutes : 0,
          walkingDistanceMeters:
            mode === TransportationMode.WALKING ? distanceMeters : 0,
          approximate: false,
          provider: 'geoapify',
        };
      },
    ),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ROUTING_PROVIDER = 'geoapify';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LangChainService)
      .useValue(fakeLangChain)
      .overrideProvider(AiEmbeddingService)
      .useValue(fakeEmbeddingService)
      .overrideProvider(GeoapifyTravelEstimateProvider)
      .useValue(fakeGeoapifyRouting)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    outboxPublisher = app.get(OutboxPublisherService);
    await truncateAll();
    accessToken = await authenticate();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function truncateAll() {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "tour_experience_component", "tour_experience", "outbox_event", "tour",
        "experience_trait", "trait_definition", "experience_evidence",
        "experience_component", "geo_entity_identity", "geo_entity", "experience",
        "crawler_search", "email_login_code", "user"
      RESTART IDENTITY CASCADE
    `);
  }

  async function resetScenarioData() {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "tour_experience_component", "tour_experience", "outbox_event", "tour",
        "experience_trait", "trait_definition", "experience_evidence",
        "experience_component", "geo_entity_identity", "geo_entity", "experience",
        "crawler_search"
      RESTART IDENTITY CASCADE
    `);
  }

  async function authenticate(): Promise<string> {
    const email = 'experience-scale-e2e@example.com';
    const codeResponse = await request(app.getHttpServer())
      .post('/auth/email/request-code')
      .send({ email })
      .expect(201);
    const authResponse = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ email, code: codeResponse.body.devCode })
      .expect(201);
    expect(authResponse.body.accessToken).toBeTruthy();
    return authResponse.body.accessToken;
  }

  async function seedScenario(
    scenario: ScenarioDefinition,
  ): Promise<SeededRow[]> {
    await resetScenarioData();
    activeInterpretation = scenario.interpretation;
    const rows = Array.from({ length: CATALOG_SIZE }, (_, index) => {
      const value = scenario.buildExperience(index);
      return {
        id: `scale-${scenario.key}-${value.oracleClass}-${String(index).padStart(3, '0')}`,
        value,
        latitude:
          -34.6037 + (value.latitudeOffset ?? (index % 10) * 0.00008),
        longitude:
          -58.3816 +
          (value.longitudeOffset ?? Math.floor(index / 10) * 0.00008),
      };
    });

    await prisma.geoEntity.createMany({
      data: rows.map((row, index) => ({
        id: `geo-${row.id}`,
        name: `Lugar ${row.value.oracleClass} ${index}`,
        kind: GeoEntityKind.PLACE,
        latitude: row.latitude,
        longitude: row.longitude,
        address: `CP8 ${scenario.key} ${index}, Buenos Aires`,
        metadata: { oracleClass: row.value.oracleClass },
      })),
    });
    await prisma.experience.createMany({
      data: rows.map((row) => ({
        id: row.id,
        canonicalName: row.value.canonicalName,
        description: row.value.description,
        durationMinutes: row.value.durationMinutes,
        price: row.value.price,
        status: ExperienceStatus.VERIFIED,
        qualityScore: row.value.qualityScore,
        latitude: row.latitude,
        longitude: row.longitude,
        openingHours: row.value.openingHours ?? alwaysOpen,
        metadata: {
          themes: row.value.themes,
          traits: row.value.traits,
          intents: row.value.intents,
          oracleClass: row.value.oracleClass,
          semanticTier: row.value.semanticTier,
          budgetLevel: row.value.budgetLevel,
          groupType: row.value.groupType,
        },
        mediaStatus: MediaStatus.ENRICHED,
        mediaUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
        embeddingProvider: EMBEDDING_IDENTITY.provider,
        embeddingModel: EMBEDDING_IDENTITY.model,
        embeddingDimensions: EMBEDDING_IDENTITY.dimensions,
        embeddingDocumentVersion: EMBEDDING_IDENTITY.documentVersion,
        embeddedAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    });
    await prisma.experienceComponent.createMany({
      data: rows.map((row) => ({
        experienceId: row.id,
        geoEntityId: `geo-${row.id}`,
        order: 1,
        role: 'venue',
        required: true,
      })),
    });

    const positive = `[${positiveVector.join(',')}]`;
    const negative = `[${negativeVector.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${negative}'::vector`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${positive}'::vector WHERE "metadata"->>'semanticTier' = 'positive'`,
    );
    expect(await prisma.experience.count()).toBe(CATALOG_SIZE);
    return rows;
  }

  async function generateTour(generationRequest: Record<string, unknown>) {
    const created = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);
    const tourId = created.body.id;
    const event = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'TourGenerationRequested',
        payload: { path: ['tourId'], equals: tourId },
      },
    });
    expect(event?.status).toBe('PENDING');
    const publication = await outboxPublisher.processNextBatch();
    expect(publication.publishedCount).toBeGreaterThanOrEqual(1);
    const response = await request(app.getHttpServer())
      .get(`/tours/${tourId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body.metadata.generationStatus).toBe('completed');
    expect(
      (await prisma.outboxEvent.findUnique({ where: { id: event!.id } }))?.status,
    ).toBe('PUBLISHED');
    return response.body;
  }

  const selectedClasses = (tour: any): string[] =>
    tour.experiences.map(
      (item: any) => item.experience.metadata.oracleClass,
    );

  const plan = (tour: any) =>
    tour.experiences.map((item: any) => ({
      experienceId: item.experienceId,
      dayNumber: item.dayNumber,
      order: item.order,
      startTime: item.startTime,
      duration: item.duration,
    }));

  for (const scenario of scenarios) {
    it(`CP8: ${scenario.title}`, async () => {
      const rows = await seedScenario(scenario);
      const expectedIds = new Set(
        rows
          .filter(
            (row) => row.value.oracleClass === scenario.expectedSelectedClass,
          )
          .map((row) => row.id),
      );
      expect(expectedIds.size).toBeGreaterThanOrEqual(
        scenario.minimumExpectedSelected,
      );

      const tour = await generateTour(scenario.request);
      expect(tour.experiences.length).toBeGreaterThanOrEqual(
        scenario.minimumExpectedSelected,
      );
      expect(tour.experiences.length).toBeLessThanOrEqual(15);
      expect(
        tour.experiences.every((item: any) =>
          expectedIds.has(item.experienceId),
        ),
      ).toBe(true);
      expect(
        selectedClasses(tour).every(
          (oracleClass) => oracleClass === scenario.expectedSelectedClass,
        ),
      ).toBe(true);
      expect(tour.metadata.generationTrace.version).toBe(3);
      expect(
        traceStep(tour, 'coverage_analysis').coverageReport
          .analyzedCandidateCount,
      ).toBeGreaterThanOrEqual(250);
      expect(
        traceStep(tour, 'coverage_analysis').coverageReport.decision.action,
      ).toBe('none');
      expect(traceStep(tour, 'candidate_pool').candidates).toHaveLength(15);
      expect(traceStep(tour, 'daily_planning').dailyPlanning.solver).toBe(
        'GreedyDailyPlanningSolver',
      );
      expect(
        tour.metadata.generationTrace.steps.some(
          (step: any) => step.stage === 'discovery',
        ),
      ).toBe(false);
      expect(tour.metadata.executionSummary.status).toBe('completed');
      scenario.assertTrace?.(tour, rows);

      const repeated = await generateTour(scenario.request);
      expect(plan(repeated)).toEqual(plan(tour));
    });
  }

  it('CP8: changing preferences changes selection direction on the same catalog', async () => {
    const scenario = scenarios[0];
    await seedScenario(scenario);
    const original = await generateTour(scenario.request);
    expect(
      selectedClasses(original).every(
        (value) => value === 'ideal_culture_walk',
      ),
    ).toBe(true);

    activeInterpretation = normalizedIntent({
      preferredThemes: ['tango', 'religion'],
      preferredIntents: ['walk'],
      positiveSemanticQuery: 'religious tango cathedral walk Buenos Aires',
    });
    const negative = `[${negativeVector.join(',')}]`;
    const positive = `[${positiveVector.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${negative}'::vector`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${positive}'::vector WHERE "metadata"->>'oracleClass' = 'religious_false_friend'`,
    );

    const changed = await generateTour({
      ...scenario.request,
      intent: {
        ...(scenario.request.intent as Record<string, unknown>),
        interests: ['tango', 'religion'],
        additionalPreferences:
          'Quiero específicamente tango, arte religioso y catedrales caminando.',
      },
    });
    expect(
      selectedClasses(changed).every(
        (value) => value === 'religious_false_friend',
      ),
    ).toBe(true);
    expect(plan(changed)).not.toEqual(plan(original));
  });
});
