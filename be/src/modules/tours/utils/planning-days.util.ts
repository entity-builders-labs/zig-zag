import {
  DailyPlanningWindow,
  PlanningDay,
} from '../interfaces/daily-planning.interface';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseIsoDate(value: string | undefined): Date | null {
  const match = value ? ISO_DATE.exec(value) : null;
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Weekday (0 = Sunday) of a planning calendar date, or null when invalid. */
export function weekdayOfPlanningDate(date: string | null): number | null {
  const parsed = date === null ? null : parseIsoDate(date);
  return parsed ? parsed.getUTCDay() : null;
}

/**
 * Builds the per-day planning frame of a request. Day `n` falls `n - 1`
 * calendar days after the first start date; without a valid start date every
 * day is undated, so no per-date fact can be resolved for it. The destination
 * timezone has no resolver yet, so it stays explicitly UNRESOLVED. No anchor
 * and no unavailable window is invented.
 */
export function buildPlanningDays(input: {
  requestedDays: number;
  startDates: string[];
  window: DailyPlanningWindow;
}): PlanningDay[] {
  const firstDate = parseIsoDate(input.startDates[0]);
  return Array.from(
    { length: input.requestedDays },
    (_, index): PlanningDay => {
      const date = firstDate
        ? new Date(firstDate.getTime() + index * 86_400_000)
            .toISOString()
            .slice(0, 10)
        : null;
      return {
        dayNumber: index + 1,
        date,
        timezone: { status: 'UNRESOLVED' },
        window: { ...input.window },
        startAnchor: null,
        endAnchor: null,
        unavailableWindows: [],
      };
    },
  );
}
