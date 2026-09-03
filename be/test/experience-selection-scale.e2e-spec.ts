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
  rangesByWeekday: {
    0: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    1: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    2: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    3: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    4: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    5: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    6: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
  },
};
const closedDuringPlanningWindow = {
  status: 'known',
  rangesByWeekday: {
    0: [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
    1: [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
    2: [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
    3: [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
    4: [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
    5: [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
    6: [{ startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1439 }],
  },
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

interface ScenarioDefinition {
  key: ScenarioKey;
  title: string;
  interpretation: Record<string, unknown>;
  request: Record<string, any>;
  expectedSelectedClass: string;
  minimumExpectedSelected: number;
  buildExperience(index: number): ScenarioExperience;
  assertTrace?: (tour: any) => void;
}

function normalizedIntent(overrides: Record<string, unknown>) {
  return {
    preferredThemes: [],
    preferredTraits: [],
    preferredIntents: [],
    excludedThemes: [],
    excludedTraits: [],
    hardExclusions: [],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: '',
    notes: ['CP8 deterministic scale acceptance'],
    ...overrides,
  };
}

function baseRequest(overrides: Record<string, any> = {}) {
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
      interests: [],
      intents: [],
      explorationStyle: 'balanced',
      additionalPreferences: '',
    },
    mobility: {
      allowedTransportationModes: ['walking'],
      maxWalkingDistancePerDayMeters: 12000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: 'moderate',
      accessibilityNeeds: [],
    },
    dietaryRestrictions: [],
    startDates: ['2026-09-07'],
    includeExistingExperiences: true,
    skipImageGeneration: true,
    excludeTours: [],
    categories: [],
    ...overrides,
  };
}

function commonExperience(
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

const scenarios: ScenarioDefinition[] = [
  {
    key: 'culture-art-tango',
    title: 'culture + art + tango + walking while religious Experiences are forbidden',
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
        return commonExperience('ideal_culture_walk', {
          canonicalName: `Paseo cultural de arte y tango ${index}`,
          description:
            'Caminata cultural con arte porteño, tango y patrimonio secular.',
          themes: ['culture', 'art', 'tango'],
          traits: ['walking', 'local culture'],
          intents: ['walk'],
          semanticTier: 'positive',
          qualityScore: 4.4,
        });
      }
      if (index < 45) {
        return commonExperience('religious_false_friend', {
          canonicalName: `Tango y arte en catedral ${index}`,
          description:
            'Caminata de tango y arte dentro de una iglesia y catedral religiosa.',
          themes: ['culture', 'art', 'tango', 'religion'],
          traits: ['walking'],
          intents: ['walk'],
          semanticTier: 'positive',
          qualityScore: 4.8,
        });
      }
      if (index % 5 === 0) {
        return commonExperience('tango_only', {
          canonicalName: `Milonga ${index}`,
          description: 'Tango nocturno sin recorrido cultural ni de arte.',
          themes: ['tango'],
          traits: ['nightlife'],
          intents: ['performance'],
        });
      }
      return commonExperience('distractor', {
        canonicalName: `Actividad general ${index}`,
        description: 'Shopping o deporte sin relación con el pedido cultural.',
        themes: index % 2 ? ['shopping'] : ['sports'],
      });
    },
    assertTrace(tour) {
      const pool = tour.metadata.generationTrace.steps.find(
        (step: any) => step.stage === 'candidate_pool',
      );
      expect(
        pool.candidates.some((candidate: any) =>
          candidate.id.includes('religious_false_friend'),
        ),
      ).toBe(false);
    },
  },
  {
    key: 'vegan-budget-duration',
    title: 'vegan gastronomy + low budget + bounded duration',
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
      intent: {
        interests: ['gastronomy'],
        intents: ['food'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Quiero comida vegana económica y experiencias cortas, sin carne.',
      },
      dietaryRestrictions: ['vegan'],
    }),
    expectedSelectedClass: 'ideal_vegan_budget',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 8) {
        return commonExperience('ideal_vegan_budget', {
          canonicalName: `Bocados veganos económicos ${index}`,
          description:
            'Experiencia gastronómica vegana, plant based, económica y compacta.',
          themes: ['gastronomy'],
          traits: ['vegan', 'low budget', 'plant based'],
          intents: ['food'],
          durationMinutes: 50,
          price: 8,
          budgetLevel: 'low',
          semanticTier: 'positive',
          qualityScore: 4.3,
        });
      }
      if (index < 32) {
        return commonExperience('vegan_too_long', {
          canonicalName: `Maratón vegana económica ${index}`,
          description:
            'Experiencia gastronómica vegana y económica que ocupa prácticamente todo el día.',
          themes: ['gastronomy'],
          traits: ['vegan', 'low budget', 'plant based'],
          intents: ['food'],
          durationMinutes: 720,
          price: 8,
          budgetLevel: 'low',
          semanticTier: 'positive',
          qualityScore: 4.3,
        });
      }
      if (index < 64) {
        return commonExperience('vegan_expensive', {
          canonicalName: `Degustación vegana premium ${index}`,
          description: 'Menú vegano premium de precio alto.',
          themes: ['gastronomy'],
          traits: ['vegan', 'premium'],
          intents: ['food'],
          durationMinutes: 90,
          price: 180,
          budgetLevel: 'high',
          qualityScore: 4.9,
        });
      }
      if (index < 96) {
        return commonExperience('cheap_non_vegan', {
          canonicalName: `Parrilla económica ${index}`,
          description: 'Parrilla barata con carne, asado, steak y chorizo.',
          themes: ['gastronomy'],
          traits: ['low budget', 'meat'],
          intents: ['food'],
          price: 7,
          budgetLevel: 'low',
        });
      }
      return commonExperience('distractor', {
        canonicalName: `Actividad no gastronómica ${index}`,
        themes: ['architecture'],
      });
    },
    assertTrace(tour) {
      const planning = tour.metadata.generationTrace.steps.find(
        (step: any) => step.stage === 'daily_planning',
      );
      expect(
        JSON.stringify(planning).includes('DAILY_TIME_CAPACITY_EXCEEDED') ||
          JSON.stringify(planning).includes('NO_FEASIBLE_DAY'),
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
      intent: {
        interests: ['culture'],
        intents: ['visit'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Movilidad reducida: priorizar lugares accesibles, cercanos y abiertos durante el recorrido.',
      },
      mobility: {
        allowedTransportationModes: ['walking'],
        maxWalkingDistancePerDayMeters: 2500,
        maxContinuousWalkingDistanceMeters: 600,
        travelPace: 'relaxed',
        accessibilityNeeds: ['accessibility'],
      },
    }),
    expectedSelectedClass: 'ideal_accessible_open',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 8) {
        return commonExperience('ideal_accessible_open', {
          canonicalName: `Museo accesible cercano ${index}`,
          description:
            'Visita cultural accesible, step-free, cercana y abierta durante el día.',
          themes: ['culture'],
          traits: ['accessibility', 'step-free'],
          intents: ['visit'],
          semanticTier: 'positive',
          openingHours: alwaysOpen,
          latitudeOffset: (index % 4) * 0.00015,
          longitudeOffset: Math.floor(index / 4) * 0.00015,
          qualityScore: 4.4,
        });
      }
      if (index < 32) {
        return commonExperience('accessible_but_closed', {
          canonicalName: `Museo accesible cerrado ${index}`,
          description:
            'Visita cultural accesible y cercana, pero sólo disponible de madrugada.',
          themes: ['culture'],
          traits: ['accessibility', 'step-free'],
          intents: ['visit'],
          semanticTier: 'positive',
          openingHours: closedDuringPlanningWindow,
          latitudeOffset: (index % 4) * 0.00015,
          longitudeOffset: Math.floor(index / 4) * 0.00015,
          qualityScore: 4.4,
        });
      }
      if (index < 64) {
        return commonExperience('accessible_far', {
          canonicalName: `Atracción accesible lejana ${index}`,
          description: 'Atracción cultural accesible pero alejada del núcleo.',
          themes: ['culture'],
          traits: ['accessibility'],
          intents: ['visit'],
          latitudeOffset: 0.032 + (index % 4) * 0.0002,
          qualityScore: 4.8,
        });
      }
      if (index < 96) {
        return commonExperience('near_inaccessible', {
          canonicalName: `Sitio con escaleras ${index}`,
          description: 'Visita cultural cercana con escaleras y sin acceso step-free.',
          themes: ['culture'],
          traits: ['stairs'],
          intents: ['visit'],
        });
      }
      return commonExperience('distractor', {
        canonicalName: `Distractor movilidad ${index}`,
        themes: ['sports'],
      });
    },
    assertTrace(tour) {
      const planning = tour.metadata.generationTrace.steps.find(
        (step: any) => step.stage === 'daily_planning',
      );
      expect(JSON.stringify(planning)).toContain('OPENING_HOURS_INCOMPATIBLE');
    },
  },
  {
    key: 'mixed-age-family',
    title: 'mixed-age family + apparently conflicting preferences',
    interpretation: normalizedIntent({
      preferredThemes: ['culture', 'interactive'],
      preferredTraits: ['family friendly'],
      groupPreferences: ['family friendly'],
      positiveSemanticQuery:
        'family friendly culture interactive mixed ages Buenos Aires',
    }),
    request: baseRequest({
      groupType: 'family',
      intent: {
        interests: ['culture', 'interactive'],
        intents: ['visit'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Familia con edades mixtas: queremos cultura para adultos pero también propuestas interactivas para chicos.',
      },
    }),
    expectedSelectedClass: 'ideal_mixed_family',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 15) {
        return commonExperience('ideal_mixed_family', {
          canonicalName: `Experiencia familiar cultural interactiva ${index}`,
          description:
            'Actividad family friendly con cultura para adultos, niños y experiencia interactiva.',
          themes: ['culture', 'interactive'],
          traits: ['family friendly', 'kids', 'adults'],
          intents: ['visit'],
          semanticTier: 'positive',
          qualityScore: 4.4,
        });
      }
      if (index < 50) {
        return commonExperience('adult_only', {
          canonicalName: `Conferencia de arte para adultos ${index}`,
          description: 'Contenido cultural extenso pensado sólo para adultos.',
          themes: ['culture'],
          traits: ['adults'],
          intents: ['visit'],
          semanticTier: 'positive',
          qualityScore: 4.7,
        });
      }
      if (index < 85) {
        return commonExperience('kids_only', {
          canonicalName: `Juego infantil ${index}`,
          description: 'Actividad interactiva para niños sin contenido cultural adulto.',
          themes: ['interactive'],
          traits: ['family friendly', 'kids'],
          intents: ['visit'],
          semanticTier: 'positive',
          qualityScore: 4.7,
        });
      }
      return commonExperience('distractor', {
        canonicalName: `Distractor familiar ${index}`,
        themes: ['nightlife'],
        traits: ['adults only'],
      });
    },
    assertTrace(tour) {
      const pool = tour.metadata.generationTrace.steps.find(
        (step: any) => step.stage === 'candidate_pool',
      );
      expect(
        pool.candidates.every((candidate: any) =>
          candidate.id.includes('ideal_mixed_family'),
        ),
      ).toBe(true);
    },
  },
  {
    key: 'long-tail',
    title: 'long-tail intent hidden inside a mostly irrelevant 320-row catalog',
    interpretation: normalizedIntent({
      preferredThemes: ['hidden history'],
      preferredTraits: ['local'],
      preferredIntents: ['walk'],
      positiveSemanticQuery:
        'hidden history local walk obscure Buenos Aires stories',
    }),
    request: baseRequest({
      intent: {
        interests: ['hidden history'],
        intents: ['walk'],
        explorationStyle: 'local_deep_dive',
        additionalPreferences:
          'Busco historias barriales poco conocidas y detalles locales fuera de los circuitos obvios.',
      },
    }),
    expectedSelectedClass: 'long_tail_ideal',
    minimumExpectedSelected: 6,
    buildExperience(index) {
      if (index < 8) {
        return commonExperience('long_tail_ideal', {
          canonicalName: `Historias ocultas del barrio ${index}`,
          description:
            'Caminata local de hidden history con relatos barriales poco conocidos.',
          themes: ['hidden history'],
          traits: ['local', 'long-tail'],
          intents: ['walk'],
          semanticTier: 'positive',
          qualityScore: 4.0,
        });
      }
      if (index < 45) {
        return commonExperience('semantic_false_friend', {
          canonicalName: `Historia icónica masiva ${index}`,
          description:
            'Recorrido turístico general por íconos conocidos, sin historias barriales ocultas.',
          themes: ['history'],
          traits: ['iconic', 'crowded'],
          intents: ['visit'],
          durationMinutes: 720,
          qualityScore: 4.9,
        });
      }
      return commonExperience('irrelevant_catalog', {
        canonicalName: `Catálogo irrelevante ${index}`,
        description: 'Shopping, deportes o entretenimiento general.',
        themes: index % 2 ? ['shopping'] : ['sports'],
        durationMinutes: 720,
      });
    },
    assertTrace(tour) {
      const coverage = tour.metadata.generationTrace.steps.find(
        (step: any) => step.stage === 'coverage_analysis',
      );
      expect(coverage.coverageReport.analyzedCandidateCount).toBeGreaterThanOrEqual(
        300,
      );
      expect(
        tour.metadata.generationTrace.steps.some(
          (step: any) => step.stage === 'discovery',
        ),
      ).toBe(false);
    },
  },
  {
    key: 'explicit-relaxation',
    title: 'over-constrained preferences require explicit hard-exclusion relaxation',
    interpretation: normalizedIntent({
      preferredThemes: ['tango'],
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
      if (index < 8) {
        return commonExperience('least_bad_after_relaxation', {
          canonicalName: `Tango en antiguo espacio religioso ${index}`,
          description:
            'Tango de alta afinidad en un antiguo espacio religioso; no existe alternativa sin conflicto en este catálogo.',
          themes: ['tango', 'religion'],
          traits: ['performance'],
          intents: ['performance'],
          semanticTier: 'positive',
          durationMinutes: 60,
          qualityScore: 4.3,
        });
      }
      return commonExperience('worse_after_relaxation', {
        canonicalName: `Actividad religiosa no relacionada ${index}`,
        description:
          'Experiencia religiosa en iglesia o catedral, sin tango ni afinidad con el pedido.',
        themes: ['religion', index % 2 ? 'shopping' : 'sports'],
        traits: ['religious'],
        intents: ['visit'],
        durationMinutes: 720,
        qualityScore: 4.8,
      });
    },
    assertTrace(tour) {
      const pool = tour.metadata.generationTrace.steps.find(
        (step: any) => step.stage === 'candidate_pool',
      );
      expect(
        pool.candidates.every(
          (candidate: any) => candidate.metadata?.hardExclusionRelaxed !== false,
        ),
      ).toBe(true);
      expect(
        pool.candidates.some((candidate: any) =>
          candidate.id.includes('least_bad_after_relaxation'),
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
  let activeInterpretation = scenarios[0].interpretation;

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
    embedDocuments: jest.fn(
      async (texts: string[]): Promise<number[][]> =>
        texts.map(() => [...positiveVector]),
    ),
  };

  const fakeEmbeddingService = {
    ensureInitialized: jest.fn(async (): Promise<void> => undefined),
    getIndexIdentity: jest.fn(() => EMBEDDING_IDENTITY),
    getStatus: jest.fn(() => ({ status: 'ready', identity: EMBEDDING_IDENTITY })),
    getEmbeddings: jest.fn(() => fakeEmbeddings),
  };

  const fakeGeoapifyRouting = {
    isAvailable: jest.fn(() => true),
    estimate: jest.fn(
      async (from: any, to: any, allowedModes: TransportationMode[]) => {
        const dLat = to.centroid.lat - from.centroid.lat;
        const dLng = to.centroid.lng - from.centroid.lng;
        const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111_000;
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
        "tour_experience_component",
        "tour_experience",
        "outbox_event",
        "tour",
        "experience_trait",
        "trait_definition",
        "experience_evidence",
        "experience_component",
        "geo_entity_identity",
        "geo_entity",
        "experience",
        "crawler_search",
        "email_login_code",
        "user"
      RESTART IDENTITY CASCADE
    `);
  }

  async function resetScenarioData() {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "tour_experience_component",
        "tour_experience",
        "outbox_event",
        "tour",
        "experience_trait",
        "trait_definition",
        "experience_evidence",
        "experience_component",
        "geo_entity_identity",
        "geo_entity",
        "experience",
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
    expect(codeResponse.body.devCode).toMatch(/^\d{6}$/);

    const authResponse = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ email, code: codeResponse.body.devCode })
      .expect(201);
    expect(authResponse.body.accessToken).toBeTruthy();
    return authResponse.body.accessToken;
  }

  async function seedScenario(scenario: ScenarioDefinition) {
    await resetScenarioData();
    activeInterpretation = scenario.interpretation;

    const rows = Array.from({ length: CATALOG_SIZE }, (_, index) => {
      const value = scenario.buildExperience(index);
      const id = `scale-${scenario.key}-${value.oracleClass}-${String(index).padStart(3, '0')}`;
      const latitude = -34.6037 + (value.latitudeOffset ?? (index % 10) * 0.00008);
      const longitude =
        -58.3816 + (value.longitudeOffset ?? Math.floor(index / 10) * 0.00008);
      return { id, index, value, latitude, longitude };
    });

    await prisma.geoEntity.createMany({
      data: rows.map(({ id, index, value, latitude, longitude }) => ({
        id: `geo-${id}`,
        name: `Lugar ${value.oracleClass} ${index}`,
        kind: GeoEntityKind.PLACE,
        latitude,
        longitude,
        address: `CP8 ${scenario.key} ${index}, Buenos Aires`,
        metadata: { oracleClass: value.oracleClass },
      })),
    });

    await prisma.experience.createMany({
      data: rows.map(({ id, value, latitude, longitude }) => ({
        id,
        canonicalName: value.canonicalName,
        description: value.description,
        durationMinutes: value.durationMinutes,
        price: value.price,
        status: ExperienceStatus.VERIFIED,
        qualityScore: value.qualityScore,
        latitude,
        longitude,
        metadata: {
          themes: value.themes,
          traits: value.traits,
          intents: value.intents,
          oracleClass: value.oracleClass,
          semanticTier: value.semanticTier,
          openingHours: value.openingHours ?? alwaysOpen,
          budgetLevel: value.budgetLevel,
          groupType: value.groupType,
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
      data: rows.map(({ id }) => ({
        experienceId: id,
        geoEntityId: `geo-${id}`,
        order: 1,
        role: 'venue',
        required: true,
      })),
    });

    const positiveVectorLiteral = `[${positiveVector.join(',')}]`;
    const negativeVectorLiteral = `[${negativeVector.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${negativeVectorLiteral}'::vector`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${positiveVectorLiteral}'::vector WHERE "metadata"->>'semanticTier' = 'positive'`,
    );

    const count = await prisma.experience.count();
    expect(count).toBe(CATALOG_SIZE);
    return rows;
  }

  async function generateTour(generationRequest: Record<string, any>) {
    const createResponse = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);

    const tourId = createResponse.body.id;
    expect(tourId).toBeTruthy();
    const pendingGeneration = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'TourGenerationRequested',
        payload: { path: ['tourId'], equals: tourId },
      },
    });
    expect(pendingGeneration).toBeTruthy();
    expect(pendingGeneration?.status).toBe('PENDING');

    const publication = await outboxPublisher.processNextBatch();
    expect(publication.claimedCount).toBeGreaterThanOrEqual(1);
    expect(publication.publishedCount).toBeGreaterThanOrEqual(1);

    const tourResponse = await request(app.getHttpServer())
      .get(`/tours/${tourId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(tourResponse.body.metadata.generationStatus).toBe('completed');

    const storedGenerationEvent = await prisma.outboxEvent.findUnique({
      where: { id: pendingGeneration!.id },
    });
    expect(storedGenerationEvent?.status).toBe('PUBLISHED');
    return tourResponse.body;
  }

  function selectedOracleClasses(tour: any): string[] {
    return tour.experiences.map(
      (item: any) => item.experience.metadata.oracleClass,
    );
  }

  function normalizedPlan(tour: any) {
    return tour.experiences.map((item: any) => ({
      experienceId: item.experienceId,
      dayNumber: item.dayNumber,
      order: item.order,
      startTime: item.startTime,
      duration: item.duration,
      components: item.components.map((component: any) => ({
        geoEntityId: component.geoEntityId,
        order: component.order,
        role: component.role,
        required: component.required,
      })),
    }));
  }

  for (const scenario of scenarios) {
    it(`CP8: ${scenario.title}`, async () => {
      const rows = await seedScenario(scenario);
      const expectedIds = new Set(
        rows
          .filter(
            ({ value }) => value.oracleClass === scenario.expectedSelectedClass,
          )
          .map(({ id }) => id),
      );
      expect(expectedIds.size).toBeGreaterThanOrEqual(
        scenario.minimumExpectedSelected,
      );

      const tour = await generateTour(scenario.request);
      expect(tour.experiences.length).toBeGreaterThanOrEqual(
        scenario.minimumExpectedSelected,
      );
      expect(tour.experiences.length).toBeLessThanOrEqual(15);

      const selectedIds = tour.experiences.map(
        (item: any) => item.experienceId,
      );
      expect(new Set(selectedIds).size).toBe(selectedIds.length);
      expect(selectedIds.every((id: string) => expectedIds.has(id))).toBe(true);
      expect(
        selectedOracleClasses(tour).every(
          (oracleClass) => oracleClass === scenario.expectedSelectedClass,
        ),
      ).toBe(true);

      expect(tour.metadata.generationTrace.version).toBe(3);
      expect(
        tour.metadata.generationTrace.materializedTourExperiences,
      ).toHaveLength(tour.experiences.length);
      const traceSteps = tour.metadata.generationTrace.steps;
      const preferenceTrace = traceSteps.find(
        (step: any) => step.stage === 'preference_interpretation',
      );
      expect(preferenceTrace.preferenceInterpretation.provider).toBe(
        'e2e-preference-interpreter',
      );
      expect(preferenceTrace.preferenceInterpretation.rawResponse).toBeTruthy();

      const coverageTrace = traceSteps.find(
        (step: any) => step.stage === 'coverage_analysis',
      );
      expect(coverageTrace.coverageReport.analyzedCandidateCount).toBeGreaterThanOrEqual(
        300,
      );
      expect(coverageTrace.coverageReport.decision.action).toBe('none');
      expect(
        traceSteps.some((step: any) => step.stage === 'discovery'),
      ).toBe(false);

      const candidatePoolTrace = traceSteps.find(
        (step: any) => step.stage === 'candidate_pool',
      );
      expect(candidatePoolTrace.candidates).toHaveLength(15);
      expect(
        candidatePoolTrace.candidates.every(
          (candidate: any) => candidate.scoreBreakdown.totalScore != null,
        ),
      ).toBe(true);

      const planningTrace = traceSteps.find(
        (step: any) => step.stage === 'daily_planning',
      );
      expect(planningTrace.dailyPlanning.solver).toBe(
        'GreedyDailyPlanningSolver',
      );
      expect(tour.metadata.executionSummary.status).toBe('completed');
      expect(tour.metadata.executionSummary.selectedExperiences).toBe(
        tour.experiences.length,
      );
      scenario.assertTrace?.(tour);

      const secondTour = await generateTour(scenario.request);
      expect(normalizedPlan(secondTour)).toEqual(normalizedPlan(tour));
    });
  }

  it('CP8: a controlled preference change changes selection direction on the same 320-row catalog', async () => {
    const scenario = scenarios[0];
    await seedScenario(scenario);
    const original = await generateTour(scenario.request);
    expect(
      selectedOracleClasses(original).every(
        (oracleClass) => oracleClass === 'ideal_culture_walk',
      ),
    ).toBe(true);

    activeInterpretation = normalizedIntent({
      preferredThemes: ['tango', 'religion'],
      preferredIntents: ['walk'],
      positiveSemanticQuery: 'religious tango cathedral walk Buenos Aires',
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${negativeVector.join(',')}'::vector`,
    ).catch(async () => {
      const negativeLiteral = `[${negativeVector.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "experience" SET "embedding" = '${negativeLiteral}'::vector`,
      );
    });
    const positiveLiteral = `[${positiveVector.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${positiveLiteral}'::vector WHERE "metadata"->>'oracleClass' = 'religious_false_friend'`,
    );

    const changedRequest = {
      ...scenario.request,
      intent: {
        ...scenario.request.intent,
        interests: ['tango', 'religion'],
        additionalPreferences:
          'Quiero específicamente tango, arte religioso y catedrales caminando.',
      },
    };
    const changed = await generateTour(changedRequest);
    expect(
      selectedOracleClasses(changed).every(
        (oracleClass) => oracleClass === 'religious_false_friend',
      ),
    ).toBe(true);
    expect(normalizedPlan(changed)).not.toEqual(normalizedPlan(original));
  });
});
