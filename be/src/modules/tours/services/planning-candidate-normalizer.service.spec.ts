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

  it('defaults duration to 0 minutes when unset', async () => {
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
