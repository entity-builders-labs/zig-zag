import { PlanningCandidateNormalizerService } from './planning-candidate-normalizer.service';

describe('PlanningCandidateNormalizerService', () => {
  let service: PlanningCandidateNormalizerService;

  beforeEach(() => {
    service = new PlanningCandidateNormalizerService({
      compositeDefaultDurationMinutes: 90,
    } as any);
  });

  it('carries persisted Experience duration in planning minutes exactly once', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'e1',
          canonicalName: 'Museo',
          latitude: 1,
          longitude: 2,
          durationMinutes: 150,
        },
      ],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(150);
  });

  it('uses canonical identity and component coordinate fallback', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'e2',
          canonicalName: 'Paseo',
          latitude: null,
          longitude: null,
          durationMinutes: 75,
          components: [
            { geoEntity: { latitude: -34.6, longitude: -58.4 } },
          ],
        },
      ],
      new Map(),
    );
    expect(candidate.experienceId).toBe('e2');
    expect(candidate.durationMinutes).toBe(75);
    expect(candidate.spatialFootprint.centroid).toEqual({
      lat: -34.6,
      lng: -58.4,
    });
  });

  it('uses all required component points for a multi-component Experience', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'multi',
          canonicalName: 'Historic walk',
          latitude: -34.6,
          longitude: -58.4,
          components: [
            {
              required: true,
              geoEntity: { latitude: -34.6, longitude: -58.4 },
            },
            {
              required: true,
              geoEntity: { latitude: -34.62, longitude: -58.42 },
            },
          ],
        },
      ],
      new Map(),
    );

    expect(candidate.spatialFootprint.type).toBe('AREA');
    expect(candidate.spatialFootprint.centroid).toEqual({
      lat: -34.61,
      lng: -58.41,
    });
    expect(
      candidate.spatialFootprint.type === 'AREA'
        ? candidate.spatialFootprint.bounds
        : undefined,
    ).toEqual({
      north: -34.6,
      south: -34.62,
      east: -58.4,
      west: -58.42,
    });
  });

  it('preserves canonical ROUTE geometry as a LINE planning footprint', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'route',
          canonicalName: 'Wine route',
          components: [
            {
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
      ],
      new Map(),
    );

    expect(candidate.spatialFootprint.type).toBe('LINE');
    if (candidate.spatialFootprint.type !== 'LINE') {
      throw new Error('Expected LINE footprint');
    }
    expect(candidate.spatialFootprint.geometry).toHaveLength(3);
    expect(candidate.spatialFootprint.centroid).toEqual({
      lat: -32.949999999999996,
      lng: -68.8,
    });
  });

  it('uses the configured default when an Experience has no duration', async () => {
    const [candidate] = await service.normalizeExperiences(
      [{ id: 'e3', canonicalName: 'Circuito', latitude: 1, longitude: 2 }],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(90);
  });

  it('preserves an explicit composite duration over the default', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'e4',
          canonicalName: 'Ruta',
          latitude: 1,
          longitude: 2,
          durationMinutes: 120,
        },
      ],
      new Map(),
    );
    expect(candidate.durationMinutes).toBe(120);
  });

  it('carries the ranking score breakdown into planner scores', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'e5',
          canonicalName: 'Comida',
          latitude: 1,
          longitude: 2,
        },
      ],
      new Map([
        ['e5', { semanticSimilarity: 0.8, qualityBonus: 0.4 } as any],
      ]),
    );
    expect(candidate.semanticScore).toBe(0.8);
    expect(candidate.qualityScore).toBe(0.4);
  });

  it('does not expose legacy structural format fields', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'e6',
          canonicalName: 'Experiencia',
          latitude: 1,
          longitude: 2,
        },
      ],
      new Map(),
    );
    expect(candidate.experienceId).toBe('e6');
    expect('formats' in candidate).toBe(false);
    expect('kind' in candidate).toBe(false);
  });

  it('preserves acquisition-provided internal mobility without deriving it from duration', async () => {
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'e7',
          canonicalName: 'Caminata',
          latitude: 1,
          longitude: 2,
          durationMinutes: 180,
          mobility: {
            internalWalkingMinutes: 5,
            internalWalkingDistanceMeters: 300,
          },
        },
      ],
      new Map(),
    );
    expect(candidate.mobility).toEqual({
      internalWalkingMinutes: 5,
      internalWalkingDistanceMeters: 300,
      internalTravelMinutes: undefined,
    });
  });

  it('passes through normalized opening hours from the verified catalog', async () => {
    const openingHours = { status: 'unknown' as const };
    const [candidate] = await service.normalizeExperiences(
      [
        {
          id: 'e8',
          canonicalName: 'Parque',
          latitude: 1,
          longitude: 2,
          openingHours,
        },
      ],
      new Map(),
    );
    expect(candidate.openingHours).toEqual(openingHours);
  });
});
