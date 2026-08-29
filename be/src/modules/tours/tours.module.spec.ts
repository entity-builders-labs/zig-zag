import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
} from './interfaces/daily-planning.interface';
import { PlanningCandidateNormalizerService } from './services/planning-candidate-normalizer.service';

describe('ToursModule DI wiring (PR10)', () => {
  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/zigzag';
  });

  it('resolves the new daily-planning providers without error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleRef.get(DAILY_PLANNING_SOLVER)).toBeDefined();
    expect(moduleRef.get(TRAVEL_ESTIMATE_PROVIDER)).toBeDefined();
    expect(moduleRef.get(TOUR_PLANNING_FEASIBILITY_VALIDATOR)).toBeDefined();
    expect(moduleRef.get(PlanningCandidateNormalizerService)).toBeDefined();
    await moduleRef.close();
  });
});
