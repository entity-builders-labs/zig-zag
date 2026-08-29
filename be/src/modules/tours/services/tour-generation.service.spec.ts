import { TourGenerationService } from './tour-generation.service';

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
      { generateTourActivities: jest.fn() } as any,
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
});

describe('TourGenerationService deprecated /tours/nearby chain (PR 10)', () => {
  it('still calls updateTravelTimesForActivities to compute travel times, confirming this legacy path is untouched', async () => {
    // PR 10 only integrates the deterministic planner into the wizard path
    // (TourActivityGenerationService); the deprecated /tours/nearby chain
    // (TourGenerationService.generateTour -> TourLocationService) keeps
    // relying on the legacy travel-time-calculator.util.ts. This test's
    // failure mode is real: if a future change removed this call site (the
    // only remaining caller), travel-time-calculator.util.ts would be dead
    // code, contradicting the "keep the file for /tours/nearby" plan intent.
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
      { generateTourActivities: jest.fn() } as any,
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
      // Both activities are within walking distance in this fixture, so the
      // legacy calculator fills in travel time/distance for the first stop
      // and leaves the last stop's outbound leg undefined.
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
