import { SSEHubService } from './sse-hub.service';

describe('SSEHubService', () => {
  let service: SSEHubService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new SSEHubService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends the initial frame, domain events and heartbeats on one channel', () => {
    const events: any[] = [];
    const subscription = service
      .getStream('tour:tour-1')
      .subscribe((event) => events.push(event));

    expect(events[0]).toEqual({
      type: 'connected',
      data: { channelId: 'tour:tour-1' },
      retry: 3000,
    });
    expect(service.hasActiveClients('tour:tour-1')).toBe(true);
    expect(
      service.emit('tour:tour-1', 'tour.progress', { status: 'generating' }),
    ).toBe(true);
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'tour.progress',
        data: { status: 'generating' },
        id: expect.any(String),
      }),
    );

    jest.advanceTimersByTime(25_000);
    expect(events[2]).toEqual({
      type: 'heartbeat',
      data: { timestamp: expect.any(String) },
    });

    subscription.unsubscribe();
    service.removeClient('tour:tour-1');
    expect(service.hasActiveClients('tour:tour-1')).toBe(false);
    expect(service.emit('tour:tour-1', 'tour.completed', {})).toBe(false);
  });

  it('does not leak events between channels', () => {
    const tourEvents: any[] = [];
    const activityEvents: any[] = [];
    const tourSubscription = service
      .getStream('tour:tour-1')
      .subscribe((event) => tourEvents.push(event));
    const activitySubscription = service
      .getStream('activity:activity-1')
      .subscribe((event) => activityEvents.push(event));

    service.emit('tour:tour-1', 'tour.completed', { tourId: 'tour-1' });

    expect(tourEvents).toHaveLength(2);
    expect(activityEvents).toHaveLength(1);

    tourSubscription.unsubscribe();
    activitySubscription.unsubscribe();
    service.removeClient('tour:tour-1');
    service.removeClient('activity:activity-1');
  });
});
