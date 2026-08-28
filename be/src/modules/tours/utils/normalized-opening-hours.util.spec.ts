import { parseOpeningHours, isOpenDuring } from './normalized-opening-hours.util';

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

describe('isOpenDuring', () => {
  it('treats unknown status as open (existing unknown-availability policy)', () => {
    expect(isOpenDuring({ status: 'unknown' }, 1, 600, 660)).toBe(true);
  });

  it('treats a missing weekday entry as open (no data for that day, not closed)', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(isOpenDuring(hours, 2, 600, 660)).toBe(true);
  });

  it('rejects a window outside the known range', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(isOpenDuring(hours, 1, 480, 540)).toBe(false); // 8:00-9:00, before opening
  });

  it('accepts a window inside the known range', () => {
    const hours = parseOpeningHours(['Monday: 9:00 AM – 6:00 PM']);
    expect(isOpenDuring(hours, 1, 600, 660)).toBe(true);
  });

  it('rejects any window on a genuinely closed day', () => {
    const hours = parseOpeningHours(['Sunday: Closed']);
    expect(isOpenDuring(hours, 0, 600, 660)).toBe(false);
  });
});
