import {
  InvalidPlanningInputError,
  validatePlanningInput,
} from './planning-input-validation.util';
import {
  PlanningExperienceCandidate,
  ResolvedCyclingLimits,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import {
  legacyCompositeCandidate,
  mobilityFixture,
  planningInputFixture,
  singleVisitCandidate,
  unknownHoursByDay,
} from '../fixtures/planning-input.fixture';
import {
  GreedyDailyPlanningSolver,
  UnsupportedPlanningInputError,
} from '../services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';

const point = (lat: number, lng: number) => ({
  type: 'POINT' as const,
  centroid: { lat, lng },
});

const codes = (candidates: PlanningExperienceCandidate[]) =>
  validatePlanningInput(
    planningInputFixture({ dayCount: 1, candidates }),
  ).candidateErrors.map((error) => [
    error.scope === 'CANDIDATE' ? error.experienceId : 'request',
    error.code,
  ]);

describe('validatePlanningInput — candidates', () => {
  it('reports a missing duration as an input error, never a default', () => {
    const withoutDuration = singleVisitCandidate({
      preferenceRank: 1,
      experienceId: 'no-duration',
    });
    withoutDuration.components[0].visit = null;
    const result = validatePlanningInput(
      planningInputFixture({
        dayCount: 1,
        candidates: [
          withoutDuration,
          singleVisitCandidate({ preferenceRank: 2, experienceId: 'ok' }),
        ],
      }),
    );
    expect(result.candidateErrors).toEqual([
      expect.objectContaining({
        scope: 'CANDIDATE',
        experienceId: 'no-duration',
        code: 'MISSING_REQUIRED_DURATION',
      }),
    ]);
    // The other candidate is still planned.
    expect(result.validCandidates.map((item) => item.experienceId)).toEqual([
      'ok',
    ]);
  });

  it('reports a duration without provenance, or without positive minutes, as MISSING_REQUIRED_DURATION', () => {
    const noProvenance = singleVisitCandidate({
      preferenceRank: 3,
      experienceId: 'no-provenance',
    });
    noProvenance.components[0].visit!.duration = {
      minutes: 60,
      provenance: undefined as never,
    };
    const zero = singleVisitCandidate({
      preferenceRank: 4,
      experienceId: 'zero',
      durationMinutes: 0,
    });
    const composite = legacyCompositeCandidate({
      preferenceRank: 5,
      experienceId: 'composite-nan',
      durationMinutes: Number.NaN,
      footprints: [point(0, 0), point(0, 0.001)],
    });
    expect(codes([noProvenance, zero, composite])).toEqual([
      ['no-provenance', 'MISSING_REQUIRED_DURATION'],
      ['zero', 'MISSING_REQUIRED_DURATION'],
      ['composite-nan', 'MISSING_REQUIRED_DURATION'],
    ]);
  });

  it('accepts a composite as one candidate only when its components keep ascending order', () => {
    const ordered = legacyCompositeCandidate({
      preferenceRank: 6,
      experienceId: 'walk',
      footprints: [point(0, 0), point(0, 0.001), point(0, 0.002)],
    });
    const reordered: PlanningExperienceCandidate = {
      ...ordered,
      experienceId: 'reordered',
      components: [ordered.components[1], ordered.components[0]],
    };
    const empty: PlanningExperienceCandidate = {
      ...ordered,
      experienceId: 'empty',
      components: [],
    };
    expect(codes([ordered, reordered, empty])).toEqual([
      ['reordered', 'INVALID_COMPOSITE'],
      ['empty', 'INVALID_COMPOSITE'],
    ]);
  });

  it('reports a NaN, null or undefined coordinate as INVALID_SPATIAL_FOOTPRINT instead of crashing', () => {
    const broken = (id: string, lat: unknown, lng: unknown) => ({
      ...singleVisitCandidate({ preferenceRank: 7, experienceId: id }),
      spatialFootprint: point(lat as number, lng as number),
    });
    expect(
      codes([
        broken('nan', Number.NaN, 0),
        broken('null-lat', null, 0),
        broken('undefined-lng', 0, undefined),
      ]),
    ).toEqual([
      ['nan', 'INVALID_SPATIAL_FOOTPRINT'],
      ['null-lat', 'INVALID_SPATIAL_FOOTPRINT'],
      ['undefined-lng', 'INVALID_SPATIAL_FOOTPRINT'],
    ]);
  });

  it('reports a repeated identity as DUPLICATE_EXPERIENCE and keeps the first', () => {
    const result = validatePlanningInput(
      planningInputFixture({
        dayCount: 1,
        candidates: [
          singleVisitCandidate({ preferenceRank: 8, experienceId: 'dup' }),
          singleVisitCandidate({ preferenceRank: 9, experienceId: 'dup' }),
        ],
      }),
    );
    expect(result.validCandidates).toHaveLength(1);
    expect(result.candidateErrors).toEqual([
      expect.objectContaining({
        experienceId: 'dup',
        code: 'DUPLICATE_EXPERIENCE',
      }),
    ]);
  });

  it('reports opening hours that do not cover every planning day', () => {
    const misaligned = singleVisitCandidate({
      preferenceRank: 10,
      experienceId: 'misaligned',
      openingHoursByDay: [
        ...unknownHoursByDay(1),
        {
          status: 'KNOWN_CLOSED',
          provenance: unknownHoursByDay(1)[0].provenance,
        },
      ],
    });
    // planningInputFixture never stretches known hours, so build the input
    // directly to keep the misalignment.
    const input = planningInputFixture({ dayCount: 1 });
    input.candidates = [misaligned];
    expect(validatePlanningInput(input).candidateErrors).toEqual([
      expect.objectContaining({
        experienceId: 'misaligned',
        code: 'INVALID_VISIT_FACTS',
      }),
    ]);
  });
});

describe('validatePlanningInput — cycling limit (owner D3)', () => {
  const requestErrors = (mobility: ReturnType<typeof mobilityFixture>) =>
    validatePlanningInput(planningInputFixture({ dayCount: 1, mobility }))
      .requestErrors;

  it('makes BICYCLE without a resolved cycling limit invalid planning input', () => {
    expect(
      requestErrors(
        mobilityFixture({
          allowedTransportationModes: [
            TransportationMode.WALKING,
            TransportationMode.CYCLING,
          ],
          cycling: null,
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        scope: 'REQUEST',
        code: 'UNRESOLVED_CYCLING_LIMIT',
      }),
    ]);
  });

  it('rejects a cycling limit that is not a positive duration', () => {
    expect(
      requestErrors(
        mobilityFixture({
          allowedTransportationModes: [TransportationMode.CYCLING],
          cycling: {
            maxContinuousCyclingMinutes: 0,
            maxDailyCyclingMinutes: null,
            source: { kind: 'USER_STATED' },
          },
        }),
      ).map((error) => error.code),
    ).toEqual(['UNRESOLVED_CYCLING_LIMIT']);
  });

  it('requires no cycling limit when bicycle is not allowed', () => {
    expect(
      requestErrors(
        mobilityFixture({
          allowedTransportationModes: [
            TransportationMode.WALKING,
            TransportationMode.DRIVING,
          ],
          cycling: null,
        }),
      ),
    ).toEqual([]);
  });

  it('accepts a resolved limit from any source, with or without a daily maximum', () => {
    const limits: ResolvedCyclingLimits[] = [
      {
        maxContinuousCyclingMinutes: 30,
        maxDailyCyclingMinutes: null,
        source: { kind: 'USER_STATED' as const },
      },
      {
        maxContinuousCyclingMinutes: 30,
        maxDailyCyclingMinutes: 90,
        source: {
          kind: 'MOBILITY_PROFILE' as const,
          profileName: 'casual-rider',
          profileVersion: 'v1',
        },
      },
    ];
    for (const cycling of limits) {
      expect(
        requestErrors(
          mobilityFixture({
            allowedTransportationModes: [TransportationMode.CYCLING],
            cycling,
          }),
        ),
      ).toEqual([]);
    }
  });
});

describe('GreedyDailyPlanningSolver input boundary', () => {
  const provider: TravelEstimateProvider = {
    estimate: jest.fn(async () => ({
      mode: TransportationMode.WALKING,
      durationMinutes: 5,
      distanceMeters: 300,
      walkingMinutes: 5,
      walkingDistanceMeters: 300,
      approximate: true,
    })),
  };
  const solver = new GreedyDailyPlanningSolver(
    provider,
    dailyPlanningPolicyConfig(),
  );

  it('plans nothing and fails explicitly when the request is invalid', async () => {
    await expect(
      solver.solve(
        planningInputFixture({
          dayCount: 1,
          candidates: [
            singleVisitCandidate({ preferenceRank: 11, experienceId: 'a' }),
          ],
          mobility: mobilityFixture({
            allowedTransportationModes: [TransportationMode.CYCLING],
          }),
        }),
      ),
    ).rejects.toThrow(InvalidPlanningInputError);
  });

  it('refuses inputs it cannot plan honestly instead of ignoring them', async () => {
    const anchored = planningInputFixture({
      dayCount: 1,
      candidates: [
        singleVisitCandidate({ preferenceRank: 12, experienceId: 'a' }),
      ],
    });
    anchored.days[0].startAnchor = { label: 'Hotel', footprint: point(0, 0) };
    await expect(solver.solve(anchored)).rejects.toThrow(
      UnsupportedPlanningInputError,
    );

    const timeline = singleVisitCandidate({
      preferenceRank: 13,
      experienceId: 'walk',
    });
    timeline.components.push({
      ...timeline.components[0],
      order: 1,
      geoEntityId: 'geo-walk-2',
    });
    await expect(
      solver.solve(
        planningInputFixture({ dayCount: 1, candidates: [timeline] }),
      ),
    ).rejects.toThrow(UnsupportedPlanningInputError);

    await expect(
      solver.solve(
        planningInputFixture({
          dayCount: 1,
          candidates: [
            singleVisitCandidate({ preferenceRank: 14, experienceId: 'a' }),
          ],
          policies: {
            rankingPolicyVersion: 'any',
            objectivePolicyVersion: 'preference-objective-v1',
            unknownOpeningHours: { mode: 'PENALIZE', version: 'p-d4-v1' },
          },
        }),
      ),
    ).rejects.toThrow(UnsupportedPlanningInputError);
  });

  it('reports candidate input errors in the solution and plans the valid rest', async () => {
    const broken = {
      ...singleVisitCandidate({ preferenceRank: 15, experienceId: 'broken' }),
      spatialFootprint: point(Number.NaN, 0),
    };
    const solution = await solver.solve(
      planningInputFixture({
        dayCount: 1,
        candidates: [
          broken,
          singleVisitCandidate({ preferenceRank: 16, experienceId: 'ok' }),
        ],
      }),
    );
    expect(solution.inputErrors).toEqual([
      expect.objectContaining({
        experienceId: 'broken',
        code: 'INVALID_SPATIAL_FOOTPRINT',
      }),
    ]);
    expect(
      solution.days[0].experiences.map((item) => item.experienceId),
    ).toEqual(['ok']);
    expect(solution.unselected).toEqual([]);
    expect(solution.metadata.policies).toMatchObject({
      rankingPolicyVersion: 'preference-utility-v2',
      objectivePolicyVersion: 'greedy-preference-rank-v1',
    });
  });

  it('refuses candidates ranked under another preference policy or without distinct ranks', async () => {
    const foreign = singleVisitCandidate({
      preferenceRank: 1,
      experienceId: 'foreign',
    });
    foreign.preference = { ...foreign.preference, policyVersion: 'other-v9' };
    await expect(
      solver.solve(
        planningInputFixture({ dayCount: 1, candidates: [foreign] }),
      ),
    ).rejects.toThrow(/preference policy other-v9/);

    await expect(
      solver.solve(
        planningInputFixture({
          dayCount: 1,
          candidates: [
            singleVisitCandidate({ preferenceRank: 1, experienceId: 'x' }),
            singleVisitCandidate({
              preferenceRank: 1,
              experienceId: 'y',
              lng: 0.001,
            }),
          ],
        }),
      ),
    ).rejects.toThrow(/distinct preference ranks/);
  });
});
