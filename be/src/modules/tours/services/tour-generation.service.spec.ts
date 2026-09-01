import { TourGenerationService } from './tour-generation.service';
import {
  TransportationMode,
  TravelPace,
} from '../interfaces/tour-generation.interface';

describe('TourGenerationService Groq prompt budget', () => {
  it('offers each candidate once and uses a completion budget below the provider TPM limit', async () => {
    jest.useFakeTimers();
    const uniqueCandidateName = 'UNIQUE_MONTEVIDEO_CANDIDATE';
    const prisma = {
      tour: { findMany: jest.fn().mockResolvedValue([]) },
      activity: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const activitiesService = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 'activity-1',
          name: uniqueCandidateName,
          type: 'cultural',
          latitude: -34.9,
          longitude: -56.18,
          duration: 60,
        },
      ]),
    };
    const langChainService = {
      config: { provider: 'groq' },
      getChatModel: jest.fn().mockReturnValue(null),
      getGenerationTimeout: jest.fn().mockReturnValue(50),
      generateChatResponse: jest.fn().mockResolvedValue(
        JSON.stringify({
          title: 'Montevideo',
          description: 'A tour',
          reasoning: 'Grounded selection.',
          estimatedDuration: 2,
          activities: [],
          totalDays: 1,
          totalDistance: 0,
          estimatedBudget: 0,
          recommendedGroupSize: 2,
          activitiesLatLng: [],
        }),
      ),
    };
    const toursService = {
      create: jest.fn().mockResolvedValue({ id: 'tour-1' }),
    };
    const service = new TourGenerationService(
      prisma as any,
      activitiesService as any,
      langChainService as any,
      { findSimilarActivities: jest.fn() } as any,
      toursService as any,
      { generateTourCoverImage: jest.fn() } as any,
    );

    try {
      await service.generateTour('Plan a grounded tour', {
        latitude: -34.9,
        longitude: -56.18,
        includeExistingActivities: true,
        skipActivities: true,
      });

      const [, userPrompt, , generationOptions] =
        langChainService.generateChatResponse.mock.calls[0];
      expect(userPrompt.split(uniqueCandidateName)).toHaveLength(2);
      expect(generationOptions.groq.maxCompletionTokens).toBe(3000);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('creates a wizard tour without directly invoking activity generation', async () => {
    const toursService = {
      create: jest.fn().mockResolvedValue({ id: 'tour-1' }),
    };
    const service = new TourGenerationService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      toursService as any,
      {} as any,
    );

    await service.createTourFromWizard(
      {
        contractVersion: 1,
        destination: { label: 'Mendoza' },
        days: 2,
        categories: [],
        intent: {
          interests: [],
          experienceFormats: [],
          explorationStyle: 'balanced',
          additionalPreferences: '',
        },
        mobility: {
          allowedTransportationModes: [TransportationMode.WALKING],
          maxWalkingDistancePerDayMeters: 10000,
          maxContinuousWalkingDistanceMeters: 3000,
          travelPace: TravelPace.MODERATE,
          accessibilityNeeds: [],
        },
        dietaryRestrictions: [],
        startDates: [],
        excludeTours: [],
        includeExistingActivities: true,
        skipImageGeneration: false,
      } as any,
      'user-1',
    );

    expect(toursService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          generationStatus: 'pending',
          generationRequest: expect.objectContaining({ contractVersion: 1 }),
        }),
      }),
    );
  });
});

describe('TourGenerationService deprecated /tours/nearby chain', () => {
  it('still calls updateTravelTimesForActivities to compute travel times', async () => {
    jest.useFakeTimers();
    const activityAId = '00000000-0000-4000-8000-000000000001';
    const activityBId = '00000000-0000-4000-8000-000000000002';
    const prisma = {
      tour: { findMany: jest.fn().mockResolvedValue([]) },
      activity: {
        findMany: jest.fn().mockResolvedValue([
          { id: activityAId, latitude: -34.9, longitude: -56.18 },
          { id: activityBId, latitude: -34.901, longitude: -56.181 },
        ]),
      },
    };
    const activitiesService = { findAll: jest.fn().mockResolvedValue([]) };
    const langChainService = {
      config: { provider: 'groq' },
      getChatModel: jest.fn().mockReturnValue(null),
      getGenerationTimeout: jest.fn().mockReturnValue(50),
      generateChatResponse: jest.fn().mockResolvedValue(
        JSON.stringify({
          title: 'Montevideo Walk',
          description: 'A tour',
          reasoning: 'Grounded selection.',
          estimatedDuration: 2,
          activities: [
            { activityId: activityAId, dayNumber: 1, duration: 1 },
            { activityId: activityBId, dayNumber: 1, duration: 1 },
          ],
          totalDays: 1,
          totalDistance: 0,
          estimatedBudget: 0,
          recommendedGroupSize: 2,
          activitiesLatLng: [],
        }),
      ),
    };
    const toursService = {
      create: jest.fn().mockResolvedValue({ id: 'tour-1' }),
    };
    const tourImageService = { generateTourCoverImage: jest.fn() };
    const service = new TourGenerationService(
      prisma as any,
      activitiesService as any,
      langChainService as any,
      { findSimilarActivities: jest.fn() } as any,
      toursService as any,
      tourImageService as any,
    );

    try {
      await service.generateTour('Plan a grounded tour', {
        latitude: -34.9,
        longitude: -56.18,
        includeExistingActivities: false,
        skipActivities: false,
      });

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [activityAId, activityBId] } },
        }),
      );
      const [tourData] = toursService.create.mock.calls[0];
      expect(tourData.activities[0].travelTimeToNext).toEqual(
        expect.any(Number),
      );
      expect(tourData.activities[0].distanceToNext).toEqual(expect.any(Number));
      expect(tourData.activities[1].travelTimeToNext).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
