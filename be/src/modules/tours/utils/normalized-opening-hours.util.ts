import {
  AppliedOpeningHours,
  GeoEntityOpeningHoursProvenance,
  LEGACY_EXPERIENCE_OPENING_HOURS,
  NormalizedOpeningHours,
  NormalizedOpeningHoursKnown,
  NormalizedOpeningHoursRange,
  PlanningDay,
  PlanningDayOpeningHours,
  PlanningOpeningWindow,
} from '../interfaces/daily-planning.interface';
import { weekdayOfPlanningDate } from './planning-days.util';

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function to12hMinutes(
  hourStr: string,
  minuteStr: string,
  meridiem: string,
): number {
  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toLowerCase() === 'pm') hour += 12;
  return hour * 60 + parseInt(minuteStr, 10);
}

function to24hMinutes(hourStr: string, minuteStr: string): number {
  return parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
}

function parseTimeRange(rangeStr: string): NormalizedOpeningHoursRange | null {
  let match: RegExpExecArray | null;

  // Try matching both times with explicit meridiem: "9:00 AM – 6:00 PM"
  match =
    /(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*[–-]\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])/.exec(
      rangeStr,
    );
  if (match) {
    return {
      startMinutesFromMidnight: to12hMinutes(match[1], match[2], match[3]),
      endMinutesFromMidnight: to12hMinutes(match[4], match[5], match[6]),
    };
  }

  // Try matching only end time with meridiem: "12:00 – 3:00 PM"
  match = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])/.exec(
    rangeStr,
  );
  if (match) {
    const meridiem = match[5];
    return {
      startMinutesFromMidnight: to12hMinutes(match[1], match[2], meridiem),
      endMinutesFromMidnight: to12hMinutes(match[3], match[4], meridiem),
    };
  }

  // Try matching 24-hour format: "HH:MM – HH:MM"
  match = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(rangeStr);
  if (match) {
    return {
      startMinutesFromMidnight: to24hMinutes(match[1], match[2]),
      endMinutesFromMidnight: to24hMinutes(match[3], match[4]),
    };
  }

  return null;
}

function parseDayLine(line: string): NormalizedOpeningHoursRange[] | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const rest = line.slice(colonIndex + 1).trim();
  if (/closed/i.test(rest)) return [];

  const ranges: NormalizedOpeningHoursRange[] = [];

  // Split by comma to handle multiple ranges on the same day
  const rangeParts = rest.split(',').map((part) => part.trim());
  for (const part of rangeParts) {
    const parsed = parseTimeRange(part);
    if (parsed) {
      ranges.push(parsed);
    }
  }

  return ranges.length > 0 ? ranges : null;
}

/** Google-style `weekdayText` → a real per-weekday structure. Unlike
 * generation-audit.util.ts's checkOpeningHours (which checks every range
 * against every day regardless of the tour's actual date), this maps each
 * range to its real weekday so day-aware hard-constraint checking is
 * possible. Scoped to the planner only — generation-audit.util.ts is not
 * touched or superseded. */
export function parseOpeningHours(
  weekdayText: string[] | null | undefined,
): NormalizedOpeningHours {
  if (!weekdayText || weekdayText.length === 0) {
    return { status: 'unknown' };
  }

  const rangesByWeekday: Record<number, NormalizedOpeningHoursRange[]> = {};
  let parsedAnyDay = false;

  for (const line of weekdayText) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const dayName = line.slice(0, colonIndex).trim().toLowerCase();
    const weekday = WEEKDAY_NAMES[dayName];
    if (weekday === undefined) continue;

    const parsed = parseDayLine(line);
    if (parsed === null) continue;
    parsedAnyDay = true;

    const sameDayRanges = rangesByWeekday[weekday] ?? [];
    for (const range of parsed) {
      if (
        range.endMinutesFromMidnight > 0 &&
        range.endMinutesFromMidnight <= range.startMinutesFromMidnight
      ) {
        // Genuine crossing (e.g. "11:00 PM – 2:00 AM"): today gets [start, 24:00), tomorrow gets [00:00, end).
        sameDayRanges.push({
          startMinutesFromMidnight: range.startMinutesFromMidnight,
          endMinutesFromMidnight: 1440,
        });
        const nextWeekday = (weekday + 1) % 7;
        const nextDayRanges = rangesByWeekday[nextWeekday] ?? [];
        nextDayRanges.push({
          startMinutesFromMidnight: 0,
          endMinutesFromMidnight: range.endMinutesFromMidnight,
        });
        rangesByWeekday[nextWeekday] = nextDayRanges;
      } else if (
        range.endMinutesFromMidnight === 0 &&
        range.startMinutesFromMidnight > 0
      ) {
        // Ends at midnight (e.g. "8:00 PM – 12:00 AM"): close at 24:00 same day only, no next-day entry.
        sameDayRanges.push({
          startMinutesFromMidnight: range.startMinutesFromMidnight,
          endMinutesFromMidnight: 1440,
        });
      } else {
        // Normal same-day range, push as-is.
        sameDayRanges.push(range);
      }
    }
    rangesByWeekday[weekday] = sameDayRanges;
  }

  if (!parsedAnyDay) {
    return { status: 'unknown' };
  }
  return { status: 'known', rangesByWeekday };
}

/**
 * Transitional projection of the legacy weekly `Experience.openingHours` into
 * per-day planning knowledge, labelled `LEGACY_EXPERIENCE_OPENING_HOURS`
 * (removed at group 41). It keeps the legacy reading exactly: a weekday with
 * ranges is open in those ranges, an explicitly empty weekday ("Closed") is
 * closed, and a missing weekday, an unknown or malformed record, or an
 * undated day are UNKNOWN. It never tightens the legacy data (the P3 rule
 * that a known pattern without a weekday window means closed belongs to the
 * GeoEntity knowledge of task 26.1).
 */
export function legacyOpeningHoursByDay(
  persisted: unknown,
  days: PlanningDay[],
): PlanningDayOpeningHours[] {
  const provenance = {
    source: LEGACY_EXPERIENCE_OPENING_HOURS,
    evidenceBacked: false,
  } as const;
  const known = isKnownLegacyOpeningHours(persisted) ? persisted : null;
  return days.map((day): PlanningDayOpeningHours => {
    const weekday = weekdayOfPlanningDate(day.date);
    const ranges =
      known && weekday !== null ? known.rangesByWeekday[weekday] : undefined;
    if (!Array.isArray(ranges)) return { status: 'UNKNOWN', provenance };
    if (ranges.length === 0) return { status: 'KNOWN_CLOSED', provenance };
    return {
      status: 'KNOWN_OPEN_WINDOW',
      windows: ranges.map(
        (range): PlanningOpeningWindow => ({
          startMinutesFromMidnight: range.startMinutesFromMidnight,
          endMinutesFromMidnight: range.endMinutesFromMidnight,
          lastAdmissionMinutesFromMidnight: null,
        }),
      ),
      provenance,
    };
  });
}

interface PersistedGeoOpeningWindow {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
  lastAdmissionMinutesFromMidnight?: number | null;
}

interface PersistedGeoOpeningSchedule {
  weekly?: Record<string, PersistedGeoOpeningWindow[]>;
  exceptions?: Record<
    string,
    | { status: 'KNOWN_CLOSED' }
    | { status: 'KNOWN_OPEN_WINDOW'; windows: PersistedGeoOpeningWindow[] }
  >;
}

/** Projects C14 GeoEntity hours only; absent or invalid knowledge stays UNKNOWN. */
export function geoEntityOpeningHoursByDay(
  geoEntityId: string,
  persisted:
    | {
        status: string;
        timezone: string | null;
        schedule: unknown;
        scheduleVersion: number | null;
        source: string;
        sourceRecordRef: string | null;
        parserVersion: string | null;
        retrievedAt: Date | string;
      }
    | null
    | undefined,
  days: PlanningDay[],
): PlanningDayOpeningHours[] {
  const provenance: GeoEntityOpeningHoursProvenance = persisted
    ? {
        source: 'GEO_ENTITY_OPENING_HOURS',
        evidenceBacked: true,
        geoEntityId,
        provider: persisted.source,
        sourceRecordRef: persisted.sourceRecordRef,
        parserVersion: persisted.parserVersion,
        retrievedAt: new Date(persisted.retrievedAt).toISOString(),
        timezone: persisted.timezone,
        scheduleVersion: persisted.scheduleVersion,
      }
    : {
        source: 'GEO_ENTITY_OPENING_HOURS',
        evidenceBacked: false,
        geoEntityId,
        provider: null,
        sourceRecordRef: null,
        parserVersion: null,
        retrievedAt: null,
        timezone: null,
        scheduleVersion: null,
      };
  const unknown = (): PlanningDayOpeningHours => ({
    status: 'UNKNOWN',
    provenance,
  });
  if (!persisted || persisted.status !== 'KNOWN') return days.map(unknown);
  const schedule = asGeoOpeningSchedule(persisted.schedule);
  if (!schedule) return days.map(unknown);
  return days.map((day): PlanningDayOpeningHours => {
    if (!day.date) return unknown();
    const exception = schedule.exceptions?.[day.date];
    if (exception?.status === 'KNOWN_CLOSED') {
      return { status: 'KNOWN_CLOSED', provenance };
    }
    if (exception?.status === 'KNOWN_OPEN_WINDOW') {
      const windows = normalizeGeoWindows(exception.windows);
      return windows
        ? { status: 'KNOWN_OPEN_WINDOW', windows, provenance }
        : unknown();
    }
    const weekday = weekdayOfPlanningDate(day.date);
    if (weekday === null) return unknown();
    const rawWindows = schedule.weekly?.[String(weekday)];
    if (!Array.isArray(rawWindows)) return unknown();
    const windows = normalizeGeoWindows(rawWindows);
    if (!windows) return unknown();
    return windows.length === 0
      ? { status: 'KNOWN_CLOSED', provenance }
      : { status: 'KNOWN_OPEN_WINDOW', windows, provenance };
  });
}

function asGeoOpeningSchedule(
  value: unknown,
): PersistedGeoOpeningSchedule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as PersistedGeoOpeningSchedule;
  if (
    candidate.weekly !== undefined &&
    (!candidate.weekly ||
      typeof candidate.weekly !== 'object' ||
      Array.isArray(candidate.weekly))
  )
    return null;
  if (
    candidate.exceptions !== undefined &&
    (!candidate.exceptions ||
      typeof candidate.exceptions !== 'object' ||
      Array.isArray(candidate.exceptions))
  )
    return null;
  return candidate;
}

function normalizeGeoWindows(
  windows: PersistedGeoOpeningWindow[],
): PlanningOpeningWindow[] | null {
  if (!Array.isArray(windows)) return null;
  const normalized: PlanningOpeningWindow[] = [];
  for (const window of windows) {
    if (
      !window ||
      !Number.isInteger(window.startMinutesFromMidnight) ||
      !Number.isInteger(window.endMinutesFromMidnight) ||
      window.startMinutesFromMidnight < 0 ||
      window.endMinutesFromMidnight > 1440 ||
      window.endMinutesFromMidnight <= window.startMinutesFromMidnight ||
      (window.lastAdmissionMinutesFromMidnight != null &&
        (!Number.isInteger(window.lastAdmissionMinutesFromMidnight) ||
          window.lastAdmissionMinutesFromMidnight <
            window.startMinutesFromMidnight ||
          window.lastAdmissionMinutesFromMidnight >
            window.endMinutesFromMidnight))
    )
      return null;
    normalized.push({
      startMinutesFromMidnight: window.startMinutesFromMidnight,
      endMinutesFromMidnight: window.endMinutesFromMidnight,
      lastAdmissionMinutesFromMidnight:
        window.lastAdmissionMinutesFromMidnight ?? null,
    });
  }
  return normalized;
}

function isKnownLegacyOpeningHours(
  value: unknown,
): value is NormalizedOpeningHoursKnown {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { status?: unknown }).status === 'known' &&
    !!(value as { rangesByWeekday?: unknown }).rangesByWeekday &&
    typeof (value as { rangesByWeekday?: unknown }).rangesByWeekday === 'object'
  );
}

/**
 * Single opening-hours check for one visit interval on one day. A known
 * window must contain the whole visit and, when known, the visit must start
 * no later than the last admission; KNOWN_CLOSED never admits a visit.
 * UNKNOWN admits the visit and is reported as UNKNOWN: that is the
 * ALLOW_WITH_UNCERTAINTY behaviour of the greedy solver until task 26.2.
 */
export function evaluateVisitOpeningHours(
  knowledge: PlanningDayOpeningHours,
  startMinutesFromMidnight: number,
  endMinutesFromMidnight: number,
): AppliedOpeningHours | null {
  if (knowledge.status === 'UNKNOWN') {
    return { status: 'UNKNOWN', provenance: knowledge.provenance };
  }
  if (knowledge.status === 'KNOWN_CLOSED') return null;
  const window = knowledge.windows.find(
    (candidate) =>
      startMinutesFromMidnight >= candidate.startMinutesFromMidnight &&
      endMinutesFromMidnight <= candidate.endMinutesFromMidnight &&
      (candidate.lastAdmissionMinutesFromMidnight === null ||
        startMinutesFromMidnight <= candidate.lastAdmissionMinutesFromMidnight),
  );
  return window
    ? { status: 'WINDOW', window, provenance: knowledge.provenance }
    : null;
}
