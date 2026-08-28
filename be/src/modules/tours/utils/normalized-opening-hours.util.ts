import {
  NormalizedOpeningHours,
  NormalizedOpeningHoursRange,
} from '../interfaces/daily-planning.interface';

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};


function to12hMinutes(hourStr: string, minuteStr: string, meridiem: string): number {
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
  match = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*[–-]\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])/.exec(
    rangeStr,
  );
  if (match) {
    return {
      startMinutesFromMidnight: to12hMinutes(match[1], match[2], match[3]),
      endMinutesFromMidnight: to12hMinutes(match[4], match[5], match[6]),
    };
  }

  // Try matching only end time with meridiem: "12:00 – 3:00 PM"
  match = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])/.exec(rangeStr);
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
      } else if (range.endMinutesFromMidnight === 0 && range.startMinutesFromMidnight > 0) {
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

/** Unknown status, and a missing weekday key, both mean "no data" and are
 * never treated as closed — matches this domain's existing
 * unknown-availability policy. Only an explicitly empty range array (a real
 * parsed "Closed") rejects. */
export function isOpenDuring(
  hours: NormalizedOpeningHours,
  weekday: number,
  startMinutesFromMidnight: number,
  endMinutesFromMidnight: number,
): boolean {
  if (hours.status === 'unknown') return true;
  const ranges = hours.rangesByWeekday[weekday];
  if (ranges === undefined) return true;
  return ranges.some(
    (r) =>
      startMinutesFromMidnight >= r.startMinutesFromMidnight &&
      endMinutesFromMidnight <= r.endMinutesFromMidnight,
  );
}
