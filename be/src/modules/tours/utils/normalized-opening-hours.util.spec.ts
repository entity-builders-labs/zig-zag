import {
  parseOpeningHours,
  evaluateVisitOpeningHours,
  legacyOpeningHoursByDay,
} from './normalized-opening-hours.util';
import { buildPlanningDays } from './planning-days.util';
import { PlanningDayOpeningHours } from '../interfaces/daily-planning.interface';

describe('parseOpeningHours', () => {
  it('parses a simple single range', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[1]).toEqual([
        { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1080 },
      ]);
    }
  });

  it('parses multiple ranges on the same day', () => {
    const hours = parseOpeningHours([
      'Monday: 12:00 – 3:00 PM, 8:00 PM – 12:00 AM',
    ]);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[1]).toHaveLength(2);
      expect(hours.rangesByWeekday[1][0]).toEqual({
        startMinutesFromMidnight: 720,
        endMinutesFromMidnight: 900,
      });
      // "8:00 PM – 12:00 AM" ends exactly at midnight, same-day close.
      expect(hours.rangesByWeekday[1][1]).toEqual({
        startMinutesFromMidnight: 1200,
        endMinutesFromMidnight: 1440,
      });
      // Verify no spurious entry on Tuesday (12:00 AM is end-of-midnight, not crossing).
      expect(hours.rangesByWeekday[2]).toBeUndefined();
    }
  });

  it('parses a fully closed day', () => {
    const hours = parseOpeningHours(['Sunday: Closed']);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[0]).toEqual([]);
    }
  });

  it('splits a range crossing midnight across two weekdays', () => {
    const hours = parseOpeningHours(['Friday: 11:00 PM – 2:00 AM']);
    expect(hours.status).toBe('known');
    if (hours.status === 'known') {
      expect(hours.rangesByWeekday[5]).toEqual([
        { startMinutesFromMidnight: 1380, endMinutesFromMidnight: 1440 },
      ]);
      expect(hours.rangesByWeekday[6]).toEqual([
        { startMinutesFromMidnight: 0, endMinutesFromMidnight: 120 },
      ]);
    }
  });

  it('returns unknown for unparseable text', () => {
    expect(parseOpeningHours(['garbled nonsense line'])).toEqual({
      status: 'unknown',
    });
  });

  it('returns unknown for missing input', () => {
    expect(parseOpeningHours(undefined)).toEqual({ status: 'unknown' });
    expect(parseOpeningHours([])).toEqual({ status: 'unknown' });
  });
});

describe('legacyOpeningHoursByDay (transitional, removed at group 41)', () => {
  const provenance = {
    source: 'LEGACY_EXPERIENCE_OPENING_HOURS',
    evidenceBacked: false,
  };
  // Monday 2026-09-07, Tuesday 2026-09-08, Sunday 2026-09-13.
  const days = [
    ...buildPlanningDays({
      requestedDays: 2,
      startDates: ['2026-09-07'],
      window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
    }),
  ];

  it('keeps the legacy reading: open ranges, explicit Closed, missing weekday UNKNOWN', () => {
    const hours = parseOpeningHours([
      'Monday: 9:00 AM – 6:00 PM',
      'Tuesday: Closed',
    ]);
    expect(legacyOpeningHoursByDay(hours, days)).toEqual([
      {
        status: 'KNOWN_OPEN_WINDOW',
        windows: [
          {
            startMinutesFromMidnight: 540,
            endMinutesFromMidnight: 1080,
            lastAdmissionMinutesFromMidnight: null,
          },
        ],
        provenance,
      },
      { status: 'KNOWN_CLOSED', provenance },
    ]);
    const sunday = buildPlanningDays({
      requestedDays: 1,
      startDates: ['2026-09-13'],
      window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
    });
    expect(legacyOpeningHoursByDay(hours, sunday)).toEqual([
      { status: 'UNKNOWN', provenance },
    ]);
  });

  it('is UNKNOWN for unknown, malformed or absent records and for undated days', () => {
    const unknown = { status: 'UNKNOWN', provenance };
    expect(legacyOpeningHoursByDay({ status: 'unknown' }, days)).toEqual([
      unknown,
      unknown,
    ]);
    expect(legacyOpeningHoursByDay('9-18', days)).toEqual([unknown, unknown]);
    expect(legacyOpeningHoursByDay(undefined, days)).toEqual([
      unknown,
      unknown,
    ]);
    const undated = buildPlanningDays({
      requestedDays: 1,
      startDates: [],
      window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
    });
    expect(
      legacyOpeningHoursByDay(
        parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']),
        undated,
      ),
    ).toEqual([unknown]);
  });
});

describe('evaluateVisitOpeningHours', () => {
  const provenance = {
    source: 'LEGACY_EXPERIENCE_OPENING_HOURS',
    evidenceBacked: false,
  } as const;
  const open = (
    start: number,
    end: number,
    lastAdmission: number | null = null,
  ): Extract<PlanningDayOpeningHours, { status: 'KNOWN_OPEN_WINDOW' }> =>
    ({
      status: 'KNOWN_OPEN_WINDOW',
      windows: [
        {
          startMinutesFromMidnight: start,
          endMinutesFromMidnight: end,
          lastAdmissionMinutesFromMidnight: lastAdmission,
        },
      ],
      provenance,
    }) satisfies PlanningDayOpeningHours;

  it('admits UNKNOWN and reports it as UNKNOWN (ALLOW_WITH_UNCERTAINTY)', () => {
    expect(
      evaluateVisitOpeningHours({ status: 'UNKNOWN', provenance }, 600, 660),
    ).toEqual({ status: 'UNKNOWN', provenance });
  });

  it('never admits a KNOWN_CLOSED day', () => {
    expect(
      evaluateVisitOpeningHours(
        { status: 'KNOWN_CLOSED', provenance },
        600,
        660,
      ),
    ).toBeNull();
  });

  it('admits a visit fully inside a window and reports that window', () => {
    expect(evaluateVisitOpeningHours(open(540, 1080), 600, 660)).toEqual({
      status: 'WINDOW',
      window: open(540, 1080).windows[0],
      provenance,
    });
  });

  it('rejects a visit that starts before opening or ends after closing', () => {
    expect(evaluateVisitOpeningHours(open(540, 1080), 480, 540)).toBeNull();
    expect(evaluateVisitOpeningHours(open(540, 1080), 1020, 1110)).toBeNull();
  });

  it('rejects a visit that starts after the last admission', () => {
    expect(
      evaluateVisitOpeningHours(open(540, 1080, 1020), 1030, 1075),
    ).toBeNull();
    expect(
      evaluateVisitOpeningHours(open(540, 1080, 1020), 1020, 1065),
    ).not.toBeNull();
  });

  it('keeps a visit inside one window of a split day', () => {
    const split: Extract<
      PlanningDayOpeningHours,
      { status: 'KNOWN_OPEN_WINDOW' }
    > = {
      status: 'KNOWN_OPEN_WINDOW',
      windows: [
        {
          startMinutesFromMidnight: 540,
          endMinutesFromMidnight: 720,
          lastAdmissionMinutesFromMidnight: null,
        },
        {
          startMinutesFromMidnight: 900,
          endMinutesFromMidnight: 1140,
          lastAdmissionMinutesFromMidnight: null,
        },
      ],
      provenance,
    };
    expect(evaluateVisitOpeningHours(split, 660, 780)).toBeNull();
    expect(evaluateVisitOpeningHours(split, 900, 1020)).toEqual({
      status: 'WINDOW',
      window: split.windows[1],
      provenance,
    });
  });
});
