import { Test, TestingModule } from '@nestjs/testing';
import { ToursController } from './tours.controller';
import { ToursService } from '../services/tours.service';
import { TourGenerationService } from '../services/tour-generation.service';
import { TourActivityGenerationService } from '../services/tour-activity-generation.service';
import { TourLocationService } from '../services/tour-location.service';

describe('ToursController', () => {
  let controller: ToursController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ToursController],
      providers: [
        { provide: ToursService, useValue: {} },
        { provide: TourGenerationService, useValue: {} },
        { provide: TourActivityGenerationService, useValue: {} },
        { provide: TourLocationService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ToursController>(ToursController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
