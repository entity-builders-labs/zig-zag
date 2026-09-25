import { Test } from '@nestjs/testing';
import { ToursModule } from './tours.module';
import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
} from './interfaces/daily-planning.interface';
import { PlanningCandidateNormalizerService } from './services/planning-candidate-normalizer.service';
import { EXPERIENCE_GROUNDED_SEARCH_PROVIDER } from './interfaces/experience-grounding.interface';
import { SerperGroundedSearchService } from './services/serper-grounded-search.service';

describe('ToursModule DI wiring (Daily Planning Solver)', () => {
  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/zigzag';
  });

  it('resolves the new daily-planning providers without error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ToursModule],
    }).compile();
    expect(moduleRef.get(DAILY_PLANNING_SOLVER)).toBeDefined();
    expect(moduleRef.get(TRAVEL_ESTIMATE_PROVIDER)).toBeDefined();
    expect(moduleRef.get(TOUR_PLANNING_FEASIBILITY_VALIDATOR)).toBeDefined();
    expect(moduleRef.get(PlanningCandidateNormalizerService)).toBeDefined();
    await moduleRef.close();
  });

  it('wires GROUNDED_SEARCH_PROVIDER=serper to exactly the Serper adapter', async () => {
    const previous = process.env.GROUNDED_SEARCH_PROVIDER;
    process.env.GROUNDED_SEARCH_PROVIDER = 'serper';
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [ToursModule],
      }).compile();
      expect(moduleRef.get(EXPERIENCE_GROUNDED_SEARCH_PROVIDER)).toBe(
        moduleRef.get(SerperGroundedSearchService),
      );
      await moduleRef.close();
    } finally {
      if (previous === undefined) delete process.env.GROUNDED_SEARCH_PROVIDER;
      else process.env.GROUNDED_SEARCH_PROVIDER = previous;
    }
  });
});
