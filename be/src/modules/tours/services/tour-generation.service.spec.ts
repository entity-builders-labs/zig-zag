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
