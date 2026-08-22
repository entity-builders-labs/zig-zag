import { HybridSearchService } from './hybrid-search.service';

describe('HybridSearchService', () => {
  const params = {
    latitude: -34.9055,
    longitude: -56.1851,
    radius: 3000,
  };

  function buildService() {
    const activitiesService = {
      findAll: jest.fn().mockResolvedValue([]),
    };
    const googlePlacesService = {
      crawlAndSaveActivities: jest.fn().mockResolvedValue({}),
    };
    const prisma = {
      crawlerSearch: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    return {
      service: new HybridSearchService(
        activitiesService as any,
        googlePlacesService as any,
        prisma as any,
      ),
      googlePlacesService,
      prisma,
    };
  }

  it('records a crawl attempt so repeated map searches respect the cooldown', async () => {
    const { service, googlePlacesService, prisma } = buildService();

    const result = await service.searchActivitiesWithCrawling(params);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.crawlingTriggered).toBe(true);
    expect(prisma.crawlerSearch.upsert).toHaveBeenCalledWith({
      where: {
        latitude_longitude: {
          latitude: params.latitude,
          longitude: params.longitude,
        },
      },
      create: expect.objectContaining({
        latitude: params.latitude,
        longitude: params.longitude,
        createdAt: expect.any(Date),
      }),
      update: { createdAt: expect.any(Date) },
    });
    expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent background crawls for the same location', async () => {
    const { service, googlePlacesService } = buildService();
    let releaseCrawl: () => void = () => undefined;
    googlePlacesService.crawlAndSaveActivities.mockImplementation(
      () => new Promise<void>((resolve) => (releaseCrawl = resolve)),
    );

    const [first, second] = await Promise.all([
      service.searchActivitiesWithCrawling(params),
      service.searchActivitiesWithCrawling(params),
    ]);
    await new Promise((resolve) => setImmediate(resolve));

    expect([first.crawlingTriggered, second.crawlingTriggered].sort()).toEqual([
      false,
      true,
    ]);
    expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalledTimes(1);
    releaseCrawl();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('does not crawl when a recent search record exists', async () => {
    const { service, googlePlacesService, prisma } = buildService();
    prisma.crawlerSearch.findFirst.mockResolvedValue({ id: 'recent-search' });

    const result = await service.searchActivitiesWithCrawling(params);

    expect(result).toEqual(
      expect.objectContaining({
        fromCache: true,
        crawlingTriggered: false,
      }),
    );
    expect(googlePlacesService.crawlAndSaveActivities).not.toHaveBeenCalled();
  });
});
