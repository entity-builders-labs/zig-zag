import { TourGenerationService } from './tour-generation.service';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';

describe('TourGenerationService canonical wizard path', () => {
  it('stores one normalized request and passes supplemental intent to selector input once', async () => {
    const toursService = {
      create: jest.fn(async (data) => ({ id: 'tour-1', ...data })),
    };
    const service = new TourGenerationService(toursService as any);
    const note = 'Prefer street photography';
    const request: TourGenerationRequest = {
      contractVersion: 1 as const,
      destination: {
        label: 'Córdoba, Argentina',
        latitude: -31.42,
        longitude: -64.18,
        scaleHint: 'settlement' as any,
      },
      days: 2,
      budgetLevel: 'low' as any,
      groupType: 'family' as any,
      intent: {
        interests: ['history'],
        explorationStyle: 'balanced' as any,
        additionalPreferences: note,
      },
      mobility: {
        allowedTransportationModes: ['walking' as any],
        maxWalkingDistancePerDayMeters: 5000,
        maxContinuousWalkingDistanceMeters: 1500,
        travelPace: 'moderate' as any,
        accessibilityNeeds: [],
      },
      dietaryRestrictions: [],
      startDates: [],
      includeExistingExperiences: true,
      skipImageGeneration: true,
      excludeTours: [],
      categories: [],
    };

    await service.createTourFromWizard(request, 'user-1');

    const persisted = toursService.create.mock.calls[0][0];
    expect(persisted.ownerId).toBe('user-1');
    expect(persisted.metadata.generationRequest).toEqual(request);
    expect(persisted.metadata).not.toHaveProperty('options');
    expect(persisted.metadata).not.toHaveProperty('preferences');
    expect(persisted.metadata.generationStatus).toBe('pending');
    expect(persisted.prompt).toContain('Interests: history');
    expect(persisted.prompt).toContain('Additional preferences: Prefer street photography');
    expect(persisted.prompt).not.toMatch(/experienceFormats|requestedFormats|point_visits|neighborhood_walks/);
  });
});
