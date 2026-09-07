import { computeDayTotals } from './day-totals.util';

describe('computeDayTotals', () => {
  it('sums experience duration (hours→minutes) and travel minutes per day', () => {
    const result = computeDayTotals([
      { dayNumber: 1, duration: 1.5, travelFromPrevious: null },
      {
        dayNumber: 1,
        duration: 2,
        travelFromPrevious: { durationMinutes: 12, walkingMinutes: 12 },
      },
      {
        dayNumber: 1,
        duration: 2,
        travelFromPrevious: { durationMinutes: 16, walkingMinutes: 0 },
      },
    ]);

    expect(result).toEqual([
      {
        dayNumber: 1,
        experienceCount: 3,
        totalExperienceMinutes: 330, // (1.5 + 2 + 2) * 60
        totalTravelMinutes: 28, // 12 + 16
        totalWalkingMinutes: 12,
        totalMinutes: 358,
      },
    ]);
  });

  it('keeps multiple days separate and sorted by dayNumber', () => {
    const result = computeDayTotals([
      { dayNumber: 2, duration: 1, travelFromPrevious: null },
      { dayNumber: 1, duration: 1, travelFromPrevious: null },
    ]);

    expect(result.map((day) => day.dayNumber)).toEqual([1, 2]);
  });

  it('ignores experiences with no dayNumber', () => {
    const result = computeDayTotals([
      { dayNumber: null, duration: 1, travelFromPrevious: null },
    ]);

    expect(result).toEqual([]);
  });

  it('treats a null duration and null travelFromPrevious as zero, not NaN', () => {
    const result = computeDayTotals([
      { dayNumber: 1, duration: null, travelFromPrevious: null },
    ]);

    expect(result).toEqual([
      {
        dayNumber: 1,
        experienceCount: 1,
        totalExperienceMinutes: 0,
        totalTravelMinutes: 0,
        totalWalkingMinutes: 0,
        totalMinutes: 0,
      },
    ]);
  });
});
