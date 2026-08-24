import { BudgetLevel } from '../interfaces/tour-generation.interface';
import { auditGeneration } from './generation-audit.util';

describe('auditGeneration', () => {
  describe('openingHoursCheck', () => {
    it('flags an activity scheduled outside its OSM-syntax opening hours', () => {
      const result = auditGeneration(
        [
          {
            activityId: 'a1',
            activityName: 'Museo Nacional',
            startTime: '20:00',
            openingHoursWeekdayText: ['Mo-Fr 09:00-18:00; Sa 10:00-14:00'],
          },
        ],
        {},
      );

      expect(result.perActivity[0].openingHoursCheck).toBe('possibly_closed');
    });

    it('marks an activity scheduled within a Google-style 12h range as ok', () => {
      const result = auditGeneration(
        [
          {
            activityId: 'a1',
            activityName: 'Museo Nacional',
            startTime: '11:00',
            openingHoursWeekdayText: ['Monday: 9:00 AM – 6:00 PM'],
          },
        ],
        {},
      );

      expect(result.perActivity[0].openingHoursCheck).toBe('ok');
    });

    it('reports no_data when there is no opening hours info', () => {
      const result = auditGeneration(
        [
          {
            activityId: 'a1',
            activityName: 'Museo Nacional',
            startTime: '11:00',
          },
        ],
        {},
      );

      expect(result.perActivity[0].openingHoursCheck).toBe('no_data');
    });
  });

  describe('priceLevelCheck', () => {
    it('flags a high price level against a low budget', () => {
      const result = auditGeneration(
        [
          {
            activityId: 'a1',
            activityName: 'Restaurante caro',
            priceLevel: 5,
          },
        ],
        { budgetLevel: BudgetLevel.LOW },
      );

      expect(result.perActivity[0].priceLevelCheck).toBe(
        'possibly_over_budget',
      );
    });

    it('accepts any price level for a high budget', () => {
      const result = auditGeneration(
        [{ activityId: 'a1', activityName: 'Restaurante caro', priceLevel: 5 }],
        { budgetLevel: BudgetLevel.HIGH },
      );

      expect(result.perActivity[0].priceLevelCheck).toBe('ok');
    });

    it('reports no_data when priceLevel is unknown', () => {
      const result = auditGeneration(
        [{ activityId: 'a1', activityName: 'Restaurante' }],
        { budgetLevel: BudgetLevel.LOW },
      );

      expect(result.perActivity[0].priceLevelCheck).toBe('no_data');
    });
  });

  describe('dietary', () => {
    it('is omitted entirely when no dietary restrictions were requested', () => {
      const result = auditGeneration(
        [{ activityId: 'a1', activityName: 'Restaurante' }],
        {},
      );

      expect(result.dietary).toBeUndefined();
    });

    it('flags unsatisfied when no activity mentions the requested restriction', () => {
      const result = auditGeneration(
        [
          {
            activityId: 'a1',
            activityName: 'Parrilla El Asador',
            type: 'restaurant',
          },
        ],
        { dietaryRestrictions: ['vegan'] },
      );

      expect(result.dietary).toMatchObject({
        requested: ['vegan'],
        satisfied: false,
      });
      expect(result.dietary?.limitation).toContain('Best-effort');
    });

    it('marks satisfied when an activity mentions a matching keyword', () => {
      const result = auditGeneration(
        [
          {
            activityId: 'a1',
            activityName: 'Restaurante Vegano Verde',
            type: 'restaurant',
          },
        ],
        { dietaryRestrictions: ['vegan'] },
      );

      expect(result.dietary?.satisfied).toBe(true);
    });
  });
});
