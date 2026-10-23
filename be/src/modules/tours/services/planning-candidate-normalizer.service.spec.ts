import { derivePreferenceUtility } from '../utils/preference-utility.util';
import { PreferenceUtilityResult } from '../interfaces/preference-utility.interface';
import { composableExperience } from '../fixtures/composable-experience.fixture';
import {
  PlanningCandidateNormalizerService,
  PlanningProjectableExperience,
  partitionPlanningReady,
} from './planning-candidate-normalizer.service';
import { collapsedVisitFacts } from '../utils/planning-candidate-facts.util';
import {
  LEGACY_DURATION_PROVENANCE,
  LEGACY_HOURS_PROVENANCE,
  planningDaysFixture,
} from '../fixtures/planning-input.fixture';

/** Two days starting on a Monday (2026-09-07), so day 1 is weekday 1. */
const DAYS = planningDaysFixture(2, { startDate: '2026-09-07' });

const venue = (
  geoEntityId: string,
  latitude: number,
  longitude: number,
  extra: Record<string, unknown> = {},
) => ({
  geoEntityId,
  role: 'venue',
  required: true,
  geoEntity: { latitude, longitude },
  ...extra,
});

/** The canonical utility of the given Experiences (no requested facets). */
const utilityOf = (
  experiences: PlanningProjectableExperience[],
): PreferenceUtilityResult => ({
  ...derivePreferenceUtility({
    experiences: experiences.map((experience) =>
      composableExperience({
        id: experience.id,
        components: experience.components ?? [],
        qualityScore: (experience as { qualityScore?: number | null })
          .qualityScore,
      }),
    ),
    preferenceSpec: { facets: [], assertions: [] },
    softAnchorIds: new Set(),
    semantic: null,
  }),
  semanticRanking: {
    status: 'not_requested',
    requestedCandidateCount: 0,
    indexedCandidateCount: 0,
  },
});

describe('PlanningCandidateNormalizerService', () => {
  const service = new PlanningCandidateNormalizerService();
  const normalize = (
    experiences: PlanningProjectableExperience[],
    context: Partial<
      Parameters<PlanningCandidateNormalizerService['normalizeExperiences']>[2]
    > = {},
  ) =>
    service.normalizeExperiences(experiences, utilityOf(experiences), {
      days: DAYS,
      ...context,
    });

  describe('planning readiness (catalogued != planning-ready)', () => {
    it('excludes an Experience without a usable duration instead of defaulting one', () => {
      const result = normalize([
        {
          id: 'no-duration',
          canonicalName: 'Circuito',
          components: [venue('g', 1, 2)],
        },
        {
          id: 'zero',
          canonicalName: 'Cero',
          durationMinutes: 0,
          components: [venue('g0', 1, 2)],
        },
        {
          id: 'ok',
          canonicalName: 'Museo',
          durationMinutes: 90,
          components: [venue('g1', 1, 2)],
        },
      ]);
      expect(
        result.candidates.map((candidate) => candidate.experienceId),
      ).toEqual(['ok']);
      expect(result.ineligible).toEqual([
        { experienceId: 'no-duration', reason: 'MISSING_REQUIRED_DURATION' },
        { experienceId: 'zero', reason: 'MISSING_REQUIRED_DURATION' },
      ]);
    });

    it('partitions the same way for composition as for projection', () => {
      const { ready, ineligible } = partitionPlanningReady([
        { id: 'a', durationMinutes: 45 },
        { id: 'b', durationMinutes: null },
      ]);
      expect(ready.map((item) => item.id)).toEqual(['a']);
      expect(ineligible).toEqual([
        { experienceId: 'b', reason: 'MISSING_REQUIRED_DURATION' },
      ]);
    });
  });

  it('labels the legacy duration as transitional, non-evidence provenance', () => {
    const [candidate] = normalize([
      {
        id: 'e1',
        canonicalName: 'Museo',
        durationMinutes: 150,
        components: [venue('g1', 1, 2)],
      },
    ]).candidates;
    expect(collapsedVisitFacts(candidate)!.duration).toEqual({
      minutes: 150,
      provenance: LEGACY_DURATION_PROVENANCE,
    });
    expect(LEGACY_DURATION_PROVENANCE.evidenceBacked).toBe(false);
  });

  it('collapses a single-place Experience to its one VISIT component’s duration and availability', () => {
    const [candidate] = normalize([
      {
        id: 'poi',
        canonicalName: 'Museo',
        latitude: -34.6,
        longitude: -58.4,
        durationMinutes: 75,
        openingHours: {
          status: 'known',
          rangesByWeekday: {
            1: [
              { startMinutesFromMidnight: 600, endMinutesFromMidnight: 1080 },
            ],
            2: [],
          },
        },
        components: [venue('g-poi', -34.6, -58.4, { order: 1 })],
      },
    ]).candidates;

    expect(candidate.components).toHaveLength(1);
    const [component] = candidate.components;
    expect(component.participation).toBe('VISIT');
    expect(candidate.legacyExperienceFacts).toBeNull();
    expect(collapsedVisitFacts(candidate)).toBe(component.visit);
    expect(component.visit).toEqual({
      duration: { minutes: 75, provenance: LEGACY_DURATION_PROVENANCE },
      openingHoursByDay: [
        {
          status: 'KNOWN_OPEN_WINDOW',
          windows: [
            {
              startMinutesFromMidnight: 600,
              endMinutesFromMidnight: 1080,
              lastAdmissionMinutesFromMidnight: null,
            },
          ],
          provenance: LEGACY_HOURS_PROVENANCE,
        },
        { status: 'KNOWN_CLOSED', provenance: LEGACY_HOURS_PROVENANCE },
      ],
    });
    expect(candidate.startFootprint).toEqual(candidate.spatialFootprint);
    expect(candidate.endFootprint).toEqual(candidate.spatialFootprint);
  });

  it('keeps legacy reading of hours: a missing weekday and an undated day are UNKNOWN', () => {
    const experience: PlanningProjectableExperience = {
      id: 'poi',
      durationMinutes: 60,
      openingHours: {
        status: 'known',
        rangesByWeekday: {
          3: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 700 }],
        },
      },
      components: [venue('g', 1, 2)],
    };
    const dated = normalize([experience]).candidates[0];
    expect(
      collapsedVisitFacts(dated)!.openingHoursByDay.map((day) => day.status),
    ).toEqual(['UNKNOWN', 'UNKNOWN']);

    const undated = service.normalizeExperiences(
      [experience],
      utilityOf([experience]),
      {
        days: planningDaysFixture(1),
      },
    ).candidates[0];
    expect(collapsedVisitFacts(undated)!.openingHoursByDay).toEqual([
      { status: 'UNKNOWN', provenance: LEGACY_HOURS_PROVENANCE },
    ]);
  });

  it('does not read opening-hours facts from metadata', () => {
    const experience: PlanningProjectableExperience = {
      id: 'poi-metadata-hours',
      durationMinutes: 60,
      metadata: {
        openingHours: {
          status: 'known',
          rangesByWeekday: {
            1: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 700 }],
          },
        },
      },
      components: [venue('g', 1, 2)],
    };

    expect(
      normalize([
        experience,
      ]).candidates[0].components[0].visit?.openingHoursByDay.map(
        (day) => day.status,
      ),
    ).toEqual(['UNKNOWN', 'UNKNOWN']);
  });

  it('projects a composite as one candidate whose components keep their order', () => {
    const [candidate] = normalize([
      {
        id: 'walk',
        canonicalName: 'Three-stop walk',
        durationMinutes: 120,
        components: [
          venue('g2', -34.601, -58.401, { order: 2 }),
          {
            geoEntityId: 'g-route',
            role: 'route',
            order: 1,
            geoEntity: { latitude: -34.6, longitude: -58.4 },
          },
          {
            geoEntityId: 'g-area',
            role: 'area',
            order: 3,
            geoEntity: { latitude: -34.603, longitude: -58.403 },
          },
          { geoEntityId: null, role: 'venue', order: 4, geoEntity: null },
        ],
      },
    ]).candidates;

    expect(
      candidate.components.map((component) => [
        component.order,
        component.geoEntityId,
        component.participation,
      ]),
    ).toEqual([
      [0, 'g-route', 'TRAVERSE'],
      [1, 'g2', 'VISIT'],
      [2, 'g-area', null],
    ]);
    // A legacy composite holds its facts only for the whole Experience.
    expect(
      candidate.components.every((component) => component.visit === null),
    ).toBe(true);
    expect(candidate.legacyExperienceFacts!.duration).toEqual({
      minutes: 120,
      provenance: LEGACY_DURATION_PROVENANCE,
    });
    expect(candidate.startFootprint).toEqual({
      type: 'POINT',
      centroid: { lat: -34.6, lng: -58.4 },
    });
    expect(candidate.endFootprint).toEqual({
      type: 'POINT',
      centroid: { lat: -34.603, lng: -58.403 },
    });
  });

  it('uses all component points for a multi-component Experience footprint', () => {
    const [candidate] = normalize([
      {
        id: 'multi',
        canonicalName: 'Historic walk',
        latitude: -34.6,
        longitude: -58.4,
        durationMinutes: 60,
        components: [
          venue('g1', -34.6, -58.4, { order: 1 }),
          venue('g2', -34.62, -58.42, { order: 2 }),
        ],
      },
    ]).candidates;

    expect(candidate.spatialFootprint.type).toBe('AREA');
    expect(candidate.spatialFootprint.centroid).toEqual({
      lat: -34.61,
      lng: -58.41,
    });
  });

  it('preserves canonical ROUTE geometry as a LINE planning footprint', () => {
    const [candidate] = normalize([
      {
        id: 'route',
        canonicalName: 'Wine route',
        durationMinutes: 240,
        components: [
          {
            geoEntityId: 'g-route',
            required: true,
            role: 'route',
            geoEntity: {
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-68.85, -32.9],
                  [-68.8, -32.95],
                  [-68.75, -33.0],
                ],
              },
            },
          },
        ],
      },
    ]).candidates;

    expect(candidate.spatialFootprint.type).toBe('LINE');
    if (candidate.spatialFootprint.type !== 'LINE') {
      throw new Error('Expected LINE footprint');
    }
    expect(candidate.spatialFootprint.geometry).toHaveLength(3);
    // A route-only Experience is not a single VISIT: its facts stay at the
    // Experience level.
    expect(candidate.legacyExperienceFacts).not.toBeNull();
  });

  it('carries the canonical preference (policy, rank, numeric breakdown) and no untyped score', () => {
    const experiences = [
      {
        id: 'e5',
        canonicalName: 'Comida',
        durationMinutes: 60,
        qualityScore: 4.7,
        components: [venue('g5', 1, 2)],
      },
      {
        id: 'e6',
        canonicalName: 'Otra',
        durationMinutes: 60,
        qualityScore: 3,
        components: [venue('g6', 1, 2.1)],
      },
    ];
    const [best, second] = normalize(experiences).candidates;
    expect(best.preference).toEqual({
      policyVersion: 'preference-utility-v2',
      rank: 1,
      breakdown: expect.objectContaining({
        quality: { status: 'KNOWN', score: 4.7 },
        semantic: { status: 'UNKNOWN', reason: 'EMPTY_QUERY' },
      }),
    });
    expect(second.preference.rank).toBe(2);
    expect(best).not.toHaveProperty('semanticScore');
    expect(best).not.toHaveProperty('qualityScore');
    expect(best).not.toHaveProperty('preferenceWeight');
  });

  it('fails explicitly for an Experience without a preference-utility assessment', () => {
    const experience = {
      id: 'orphan',
      canonicalName: 'Orphan',
      durationMinutes: 60,
      components: [venue('g-orphan', 1, 2)],
    };
    expect(() =>
      service.normalizeExperiences([experience], utilityOf([]), {
        days: DAYS,
      }),
    ).toThrow(/without a preference-utility assessment/);
  });

  it('carries only resolved MUST venue IDs as must-include', () => {
    const experience = (id: string) => ({
      id,
      canonicalName: id,
      durationMinutes: 60,
      components: [venue(`g-${id}`, 1, 2)],
    });
    const [must, soft, ordinary] = normalize(
      [experience('must'), experience('soft'), experience('ordinary')],
      { mustIncludeExperienceIds: new Set(['must']) },
    ).candidates;

    expect(must.mustInclude).toBe(true);
    expect(soft.mustInclude).toBe(false);
    expect(ordinary.mustInclude).toBe(false);
  });

  it('preserves acquisition-provided internal mobility without deriving it from duration', () => {
    const [candidate] = normalize([
      {
        id: 'e7',
        canonicalName: 'Caminata',
        durationMinutes: 180,
        mobility: {
          internalWalkingMinutes: 5,
          internalWalkingDistanceMeters: 300,
        },
        components: [venue('g7', 1, 2)],
      },
    ]).candidates;
    expect(candidate.mobility).toEqual({
      internalWalkingMinutes: 5,
      internalWalkingDistanceMeters: 300,
      maxInternalContinuousWalkingDistanceMeters: undefined,
      internalTravelMinutes: undefined,
      routingProviderCounts: undefined,
      routingFallbackCount: undefined,
    });
  });

  it('does not expose legacy structural format fields', () => {
    const [candidate] = normalize([
      {
        id: 'e6',
        canonicalName: 'Experiencia',
        durationMinutes: 60,
        components: [venue('g6', 1, 2)],
      },
    ]).candidates;
    expect('formats' in candidate).toBe(false);
    expect('kind' in candidate).toBe(false);
    expect('durationMinutes' in candidate).toBe(false);
    expect('openingHours' in candidate).toBe(false);
  });

  describe('revision-4 single-place knowledge projection', () => {
    const structured = (
      overrides: Partial<PlanningProjectableExperience> = {},
    ): PlanningProjectableExperience => ({
      id: 'structured-place',
      canonicalName: 'Museum',
      compositionSignature: 'v1:stable',
      durationMinutes: 180,
      metadata: {
        openingHours: {
          status: 'known',
          rangesByWeekday: {
            1: [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1440 }],
          },
        },
      },
      components: [
        {
          geoEntityId: 'geo-structured',
          participation: 'VISIT',
          required: true,
          geoEntity: {
            latitude: 1,
            longitude: 2,
            visitDuration: {
              status: 'RESOLVED',
              typicalMinutes: 75,
              authorityClass: 'STRUCTURED_PROVIDER',
              evidenceQuality: 'DIRECT',
              evidence: [{ source: 'fixture' }],
              resolverVersion: 'duration-v1',
              resolvedAt: '2026-10-19T00:00:00.000Z',
            },
            openingHours: {
              status: 'UNKNOWN',
              timezone: null,
              schedule: null,
              scheduleVersion: null,
              source: 'openstreetmap',
              sourceRecordRef: 'osm:node:1',
              parserVersion: null,
              retrievedAt: '2026-10-19T00:00:00.000Z',
            },
          },
        },
      ],
      ...overrides,
    });

    it('projects C14 duration and provenance without reading the legacy duration', () => {
      const result = normalize([structured()]);
      expect(result.candidates[0].components[0].visit?.duration).toEqual({
        minutes: 75,
        provenance: {
          source: 'GEO_ENTITY_VISIT_DURATION',
          evidenceBacked: true,
          geoEntityId: 'geo-structured',
          authorityClass: 'STRUCTURED_PROVIDER',
          evidenceQuality: 'DIRECT',
          evidence: [{ source: 'fixture' }],
          resolverVersion: 'duration-v1',
          resolvedAt: '2026-10-19T00:00:00.000Z',
        },
      });
    });

    it('keeps absent C14 duration missing despite a legacy Experience duration', () => {
      const experience = structured({
        components: [
          {
            geoEntityId: 'geo-structured',
            participation: 'VISIT',
            geoEntity: { latitude: 1, longitude: 2, visitDuration: null },
          },
        ],
      });
      expect(normalize([experience])).toMatchObject({
        candidates: [],
        ineligible: [
          {
            experienceId: 'structured-place',
            reason: 'MISSING_REQUIRED_DURATION',
          },
        ],
      });
    });

    it('keeps UNKNOWN C14 hours UNKNOWN instead of reading metadata hours', () => {
      const candidate = normalize([structured()]).candidates[0];
      expect(candidate.components[0].visit?.openingHoursByDay[0]).toEqual({
        status: 'UNKNOWN',
        provenance: {
          source: 'GEO_ENTITY_OPENING_HOURS',
          evidenceBacked: true,
          geoEntityId: 'geo-structured',
          provider: 'openstreetmap',
          sourceRecordRef: 'osm:node:1',
          parserVersion: null,
          retrievedAt: '2026-10-19T00:00:00.000Z',
          timezone: null,
          scheduleVersion: null,
        },
      });
    });

    it('keeps missing C14 hours UNKNOWN despite legacy opening-hours values', () => {
      const experience = structured({
        components: [
          {
            geoEntityId: 'geo-structured',
            participation: 'VISIT',
            geoEntity: {
              latitude: 1,
              longitude: 2,
              visitDuration:
                structured().components![0].geoEntity!.visitDuration,
            },
          },
        ],
      });
      expect(
        normalize([experience]).candidates[0].components[0].visit
          ?.openingHoursByDay[0],
      ).toMatchObject({
        status: 'UNKNOWN',
        provenance: {
          source: 'GEO_ENTITY_OPENING_HOURS',
          evidenceBacked: false,
          geoEntityId: 'geo-structured',
          provider: null,
        },
      });
    });

    it('projects a known weekly window with its source provenance', () => {
      const experience = structured({
        components: [
          {
            geoEntityId: 'geo-structured',
            participation: 'VISIT',
            geoEntity: {
              latitude: 1,
              longitude: 2,
              visitDuration:
                structured().components![0].geoEntity!.visitDuration,
              openingHours: {
                status: 'KNOWN',
                timezone: 'America/Argentina/Buenos_Aires',
                schedule: {
                  weekly: {
                    '1': [
                      {
                        startMinutesFromMidnight: 540,
                        endMinutesFromMidnight: 1020,
                        lastAdmissionMinutesFromMidnight: 960,
                      },
                    ],
                  },
                },
                scheduleVersion: 1,
                source: 'institutional',
                sourceRecordRef: 'hours:1',
                parserVersion: 'hours-v1',
                retrievedAt: '2026-10-19T00:00:00.000Z',
              },
            },
          },
        ],
      });
      const candidate = normalize([experience]).candidates[0];
      expect(candidate.components[0].visit?.openingHoursByDay[0]).toMatchObject(
        {
          status: 'KNOWN_OPEN_WINDOW',
          windows: [
            {
              startMinutesFromMidnight: 540,
              endMinutesFromMidnight: 1020,
              lastAdmissionMinutesFromMidnight: 960,
            },
          ],
          provenance: {
            source: 'GEO_ENTITY_OPENING_HOURS',
            provider: 'institutional',
            sourceRecordRef: 'hours:1',
            scheduleVersion: 1,
          },
        },
      );
    });
  });
});
