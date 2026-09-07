import { buildTourExperienceCreateData } from './tour-experience-snapshot.util';

describe('buildTourExperienceCreateData', () => {
  const baseSelected = {
    dayNumber: 1,
    order: 2,
    startTime: new Date('2026-09-06T14:00:00.000Z'),
    duration: 1.5,
    notes: undefined as string | undefined,
    travelFromPrevious: null as any,
  };

  const experienceWithOrderedComponents = {
    id: 'exp-1',
    components: [
      {
        geoEntityId: 'geo-1',
        order: 2,
        role: 'venue',
        required: true,
        geoEntity: {
          name: 'Plaza Dorrego',
          latitude: -34.6205,
          longitude: -58.3718,
          geometry: { type: 'Point', coordinates: [-58.3718, -34.6205] },
        },
      },
      {
        geoEntityId: 'geo-2',
        order: 1,
        role: 'venue',
        required: true,
        geoEntity: {
          name: 'San Telmo Fair',
          latitude: -34.6114,
          longitude: -58.3719,
          geometry: { type: 'Point', coordinates: [-58.3719, -34.6114] },
        },
      },
    ],
  };

  it('persists a real, evidence-backed component order unchanged', () => {
    const result = buildTourExperienceCreateData(
      'tour-1',
      baseSelected,
      experienceWithOrderedComponents,
    );

    expect(result.components.create).toEqual([
      expect.objectContaining({ geoEntityId: 'geo-1', order: 2 }),
      expect.objectContaining({ geoEntityId: 'geo-2', order: 1 }),
    ]);
  });

  it('preserves null order instead of fabricating an array-position sequence (real regression)', () => {
    // Verified live this session: the old code did
    // `order: component.order ?? index + 1`, permanently baking a fake
    // sequence into the Tour snapshot for a genuinely unordered Experience
    // ("Plazas históricas de Mendoza" style — no real intrinsic order).
    const experienceWithUnorderedComponents = {
      id: 'exp-2',
      components: [
        {
          geoEntityId: 'geo-3',
          order: null as number | null,
          role: 'venue',
          required: true,
          geoEntity: {
            name: 'Plaza España',
            latitude: -32.89,
            longitude: -68.84,
            geometry: null as unknown,
          },
        },
        {
          geoEntityId: 'geo-4',
          order: null as number | null,
          role: 'venue',
          required: true,
          geoEntity: {
            name: 'Plaza Chile',
            latitude: -32.891,
            longitude: -68.841,
            geometry: null as unknown,
          },
        },
      ],
    };

    const result = buildTourExperienceCreateData(
      'tour-1',
      baseSelected,
      experienceWithUnorderedComponents,
    );

    expect(result.components.create).toEqual([
      expect.objectContaining({ geoEntityId: 'geo-3', order: null }),
      expect.objectContaining({ geoEntityId: 'geo-4', order: null }),
    ]);
  });

  it('persists travelFromPrevious when the solver computed one', () => {
    const travelFromPrevious = {
      mode: 'WALKING',
      durationMinutes: 12,
      distanceMeters: 850,
      walkingMinutes: 12,
      walkingDistanceMeters: 850,
      approximate: true,
      provider: 'approximate',
    };

    const result = buildTourExperienceCreateData(
      'tour-1',
      { ...baseSelected, travelFromPrevious },
      experienceWithOrderedComponents,
    );

    expect(result.travelFromPrevious).toEqual(travelFromPrevious);
  });

  it("persists null travelFromPrevious for a day's first stop", () => {
    const result = buildTourExperienceCreateData(
      'tour-1',
      { ...baseSelected, travelFromPrevious: null },
      experienceWithOrderedComponents,
    );

    expect(result.travelFromPrevious).toBeNull();
  });

  it('maps every scalar field onto the create input', () => {
    const result = buildTourExperienceCreateData(
      'tour-1',
      baseSelected,
      experienceWithOrderedComponents,
    );

    expect(result).toEqual(
      expect.objectContaining({
        tourId: 'tour-1',
        experienceId: 'exp-1',
        dayNumber: 1,
        order: 2,
        startTime: baseSelected.startTime,
        duration: 1.5,
        notes: undefined,
      }),
    );
  });
});
