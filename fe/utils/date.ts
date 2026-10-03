// `new Date("YYYY-MM-DD")` parses the string as UTC midnight, not local
// midnight — displaying that in a timezone behind UTC (e.g. Argentina,
// UTC-3) rolls it back to the previous day. Every date this app hands
// around as a string is a plain "YYYY-MM-DD" (no time component), so it
// must always be parsed as a local date instead of via the Date
// constructor directly.
export function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}
