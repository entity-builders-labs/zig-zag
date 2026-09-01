import { PlanningCandidateNormalizerService } from './planning-candidate-normalizer.service';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { ActivityKind } from '@prisma/client';

describe('PlanningCandidateNormalizerService', () => {
  let prisma: any;
  let travelEstimateProvider: any;
  let service: PlanningCandidateNormalizerService;

  beforeEach(() => {
    prisma = {
      activityWaypoint: { findMany: jest.fn().mockResolvedValue([]) },
    };
    travelEstimateProvider = {
      estimate: jest.fn().mockResolvedValue({
        mode: TransportationMode.WALKING,
        durationMinutes: 5,
        distanceMeters: 300,
        walkingMinutes: 5,
        walkingDistanceMeters: 300,
        approximate: true,
      }),
    };
    service = new PlanningCandidateNormalizerService(
      prisma,
      travelEstimateProvider,
      {
        internalWalking: { unknownFallbackMinutes: 20 },
        compositeDefaultDurationMinutes: 90,
      } as any,
    );
  });

  it('converts persisted hours duration to planning minutes exactly once', async () => {
    const [candidate] = await service.normalize(
      [
        {
          id: 'a',
          kind: ActivityKind.POI,
          name: 'A',
          latitude: 1,
          longitude: 2,
          duration: 2.5,
        },
      ],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(150);
  });

  it('normalizes a native verified Experience using its canonical identity and component fallback', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'experience-1',
          canonicalName: 'Visitar el museo',
          durationMinutes: 75,
          latitude: null,
          longitude: null,
          components: [
            {
              geoEntity: {
                latitude: -34.6,
                longitude: -58.4,
              },
            },
          ],
        },
      ],
      new Map(),
    );

    expect(candidate.experienceId).toBe('experience-1');
    expect(candidate.activityId).toBe('experience-1');
    expect(candidate.durationMinutes).toBe(75);
    expect(candidate.spatialFootprint.centroid).toEqual({
      lat: -34.6,
      lng: -58.4,
    });
  });

  it('defaults a POI duration to 0 minutes when unset', async () => {
    const [candidate] = await service.normalize(
      [
        {
          id: 'a',
          kind: ActivityKind.POI,
          name: 'A',
          latitude: 1,
          longitude: 2,
          duration: null,
        },
      ],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(0);
  });

  it('falls back to the composite policy duration when a composite has no persisted duration', async () => {
    const candidates = await service.normalize(
      [
        {
          id: 'walk',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          name: 'Walk',
          latitude: 1,
          longitude: 2,
          duration: null,
        },
        {
          id: 'route',
          kind: ActivityKind.ROUTE,
          name: 'Route',
          latitude: 1,
          longitude: 2,
          duration: undefined,
        },
        {
          id: 'experience',
          kind: ActivityKind.EXPERIENCE,
          name: 'Experience',
          latitude: 1,
          longitude: 2,
        },
      ],
      new Map(),
    );
    expect(candidates.map((c) => c.durationMinutes)).toEqual([90, 90, 90]);
  });

  it('prefers a composite Activity own persisted duration over the policy fallback', async () => {
    const [candidate] = await service.normalize(
      [
        {
          id: 'walk',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          name: 'Walk',
          latitude: 1,
          longitude: 2,
          duration: 2,
        },
      ],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(120);
  });

  it('carries the score breakdown into semanticScore/qualityScore', async () => {
    const [candidate] = await service.normalize(
      [
        {
          id: 'a',
          kind: ActivityKind.POI,
          name: 'A',
          latitude: 1,
          longitude: 2,
          duration: 1,
        },
      ],
      new Map([
        [
          'a',
          {
            semanticSimilarity: 0.8,
            qualityBonus: 0.4,
            proximityBonus: 0,
            diversityBonus: 0,
            totalScore: 1.2,
          },
        ],
      ]),
    );
    expect(candidate.semanticScore).toBe(0.8);
    expect(candidate.qualityScore).toBe(0.4);
  });

  it('maps POI to POINT_VISITS and NEIGHBORHOOD_WALK to NEIGHBORHOOD_WALKS', async () => {
    const [poi, walk] = await service.normalize(
      [
        {
          id: 'poi',
          kind: ActivityKind.POI,
          name: 'POI',
          latitude: 1,
          longitude: 2,
          duration: 1,
        },
        {
          id: 'walk',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          name: 'Walk',
          latitude: 1,
          longitude: 2,
          duration: null,
        },
      ],
      new Map(),
    );
    expect(poi.formats).toEqual(['point_visits']);
    expect(walk.formats).toEqual(['neighborhood_walks']);
  });

  it('never derives internal walking from duration — represents it as unknown with too few waypoints', async () => {
    prisma.activityWaypoint.findMany.mockResolvedValue([]);
    const [walk] = await service.normalize(
      [
        {
          id: 'walk',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          name: 'Walk',
          latitude: 1,
          longitude: 2,
          duration: 3,
        },
      ],
      new Map(),
    );
    expect(walk.mobility?.internalWalkingMinutes).toBeUndefined();
  });

  it('computes internal walking from ordered waypoint coordinates when resolvable', async () => {
    prisma.activityWaypoint.findMany.mockResolvedValue([
      { order: 1, waypointActivity: { latitude: 0, longitude: 0 } },
      { order: 2, waypointActivity: { latitude: 0, longitude: 0.001 } },
    ]);
    const [walk] = await service.normalize(
      [
        {
          id: 'walk',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          name: 'Walk',
          latitude: 1,
          longitude: 2,
          duration: null,
        },
      ],
      new Map(),
    );
    expect(walk.mobility?.internalWalkingMinutes).toBe(5);
    expect(travelEstimateProvider.estimate).toHaveBeenCalledWith(
      { type: 'POINT', centroid: { lat: 0, lng: 0 } },
      { type: 'POINT', centroid: { lat: 0, lng: 0.001 } },
      [TransportationMode.WALKING],
    );
  });

  it('parses opening hours from the raw weekdayText shape', async () => {
    const [candidate] = await service.normalize(
      [
        {
          id: 'a',
          kind: ActivityKind.POI,
          name: 'A',
          latitude: 1,
          longitude: 2,
          duration: 1,
          openingHours: { weekdayText: ['Monday: 9:00 AM – 6:00 PM'] },
        },
      ],
      new Map(),
    );
    expect(candidate.openingHours?.status).toBe('known');
  });
});
