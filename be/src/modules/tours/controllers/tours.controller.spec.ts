import { Test, TestingModule } from '@nestjs/testing';
import { ToursController } from './tours.controller';
import { ToursService } from '../services/tours.service';
import { TourGenerationService } from '../services/tour-generation.service';
import { TourActivityGenerationService } from '../services/tour-activity-generation.service';
import { TourLocationService } from '../services/tour-location.service';

describe('ToursController', () => {
  let controller: ToursController;

  const currentUser = { id: 'user-1', email: 'user@example.com' };

  const mockToursService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const mockTourGenerationService = { createTourFromWizard: jest.fn() };
  const mockTourActivityGenerationService = {
    generateTourActivities: jest.fn(),
    updateTourActivityWaypoints: jest.fn(),
  };
  const mockTourLocationService = { getNearbyTours: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ToursController],
      providers: [
        { provide: ToursService, useValue: mockToursService },
        { provide: TourGenerationService, useValue: mockTourGenerationService },
        {
          provide: TourActivityGenerationService,
          useValue: mockTourActivityGenerationService,
        },
        { provide: TourLocationService, useValue: mockTourLocationService },
      ],
    }).compile();

    controller = module.get<ToursController>(ToursController);
    // resetAllMocks (not clearAllMocks) so a mockImplementation set in one
    // test — e.g. the ownership-error case below — can't leak into the next.
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create() forces ownerId to the authenticated user, ignoring any client-supplied value', () => {
    controller.create(
      { name: 'Tour', ownerId: 'someone-else' } as any,
      currentUser,
    );

    expect(mockToursService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Tour', ownerId: 'user-1' }),
    );
  });

  it('generateTour() passes the authenticated user as ownerId', () => {
    controller.generateTour({} as any, currentUser);

    expect(mockTourGenerationService.createTourFromWizard).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'user-1' }),
    );
  });

  it('generateActivities() checks ownership before starting generation', async () => {
    mockToursService.findOne.mockResolvedValue({ id: 'tour-1' });

    await controller.generateActivities('tour-1', currentUser);

    expect(mockToursService.findOne).toHaveBeenCalledWith('tour-1', 'user-1');
    expect(
      mockTourActivityGenerationService.generateTourActivities,
    ).toHaveBeenCalledWith('tour-1');
  });

  it('generateActivities() propagates the ownership error without starting generation', async () => {
    class ForbiddenError extends Error {}
    mockToursService.findOne.mockImplementation(() =>
      Promise.reject(new ForbiddenError('forbidden')),
    );

    let caught: unknown;
    try {
      await controller.generateActivities('tour-1', currentUser);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ForbiddenError);
    expect(
      mockTourActivityGenerationService.generateTourActivities,
    ).not.toHaveBeenCalled();
  });

  it('findAll() scopes the listing to the authenticated user', () => {
    controller.findAll(currentUser, 1, 10);

    expect(mockToursService.findAll).toHaveBeenCalledWith(
      'user-1',
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('findOne() passes the authenticated user for the ownership check', () => {
    controller.findOne('tour-1', currentUser);

    expect(mockToursService.findOne).toHaveBeenCalledWith('tour-1', 'user-1');
  });

  it('update() passes the authenticated user for the ownership check', () => {
    controller.update('tour-1', { name: 'New' }, currentUser);

    expect(mockToursService.update).toHaveBeenCalledWith(
      'tour-1',
      { name: 'New' },
      'user-1',
    );
  });

  it('remove() passes the authenticated user for the ownership check', () => {
    controller.remove('tour-1', currentUser);

    expect(mockToursService.remove).toHaveBeenCalledWith('tour-1', 'user-1');
  });

  it('updateActivityWaypoints() delegates to the service with the tour/tourActivity ids and the requested subset', () => {
    controller.updateActivityWaypoints('tour-1', 'ta-1', {
      selectedWaypointActivityIds: ['wp-1', 'wp-2'],
    });

    expect(
      mockTourActivityGenerationService.updateTourActivityWaypoints,
    ).toHaveBeenCalledWith('tour-1', 'ta-1', ['wp-1', 'wp-2']);
  });
});
