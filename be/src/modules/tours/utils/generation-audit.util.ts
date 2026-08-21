import { BudgetLevel } from '../dto/create-tour-from-prompt.dto';

export interface AuditActivityInput {
  activityId?: string;
  activityName: string;
  // Raw "HH:MM" string as returned by the AI — the DTO transform step
  // (activity-transformer.util.ts) drops this for real dates, so audit
  // against the AI's raw response, not the persisted TourActivity.
  startTime?: string;
  type?: string;
  notes?: string;
  // Real data for the candidate this activityId matched, when known.
  openingHoursWeekdayText?: string[];
  priceLevel?: number | null;
}

export type OpeningHoursCheck = 'ok' | 'possibly_closed' | 'no_data';
export type PriceLevelCheck = 'ok' | 'possibly_over_budget' | 'no_data';

export interface AuditFinding {
  activityId?: string;
  activityName: string;
  openingHoursCheck: OpeningHoursCheck;
  priceLevelCheck: PriceLevelCheck;
}

export interface DietaryAuditFinding {
  requested: string[];
  satisfied: boolean;
  // Always present — this check is inherently best-effort (free-text
  // keyword matching over type/name/notes, no structured dietary data on
  // Activity), so callers should never treat `satisfied` as authoritative.
  limitation: string;
}

export interface GenerationAuditResult {
  perActivity: AuditFinding[];
  dietary?: DietaryAuditFinding;
}

// Extracts every HH:MM-HH:MM (24h, e.g. Geoapify/OSM "09:00-18:00") and
// H:MM AM/PM – H:MM AM/PM (12h, e.g. Google "9:00 AM – 6:00 PM") range found
// in the text, as [startMinutes, endMinutes] pairs.
//
// Known limitation: this does NOT match ranges to a specific weekday. A
// tour's dayNumber (1, 2, 3...) only maps to a real calendar weekday given
// the tour's actual start date, which isn't reliably available here — so an
// activity is checked against every range mentioned for the place, not just
// the one for its actual day. This can produce false negatives (flagging a
// place as possibly closed when a *different* day's hours would have fit)
// but not false positives from a fabricated schedule.
function extractTimeRangesInMinutes(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  const pattern24h = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
  for (const m of text.matchAll(pattern24h)) {
    ranges.push([
      Number(m[1]) * 60 + Number(m[2]),
      Number(m[3]) * 60 + Number(m[4]),
    ]);
  }

  const pattern12h =
    /(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/gi;
  for (const m of text.matchAll(pattern12h)) {
    const to24h = (h: string, meridiem: string) => {
      let hours = Number(h) % 12;
      if (meridiem.toUpperCase() === 'PM') hours += 12;
      return hours;
    };
    ranges.push([
      to24h(m[1], m[3]) * 60 + Number(m[2]),
      to24h(m[4], m[6]) * 60 + Number(m[5]),
    ]);
  }

  return ranges;
}

function parseHHMMToMinutes(startTime: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})/.exec(startTime.trim());
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function checkOpeningHours(
  startTime: string | undefined,
  weekdayText: string[] | undefined,
): OpeningHoursCheck {
  if (!startTime || !weekdayText?.length) return 'no_data';

  const startMinutes = parseHHMMToMinutes(startTime);
  if (startMinutes == null) return 'no_data';

  const ranges = extractTimeRangesInMinutes(weekdayText.join('; '));
  if (ranges.length === 0) return 'no_data';

  const fitsAnyRange = ranges.some(
    ([open, close]) => startMinutes >= open && startMinutes <= close,
  );
  return fitsAnyRange ? 'ok' : 'possibly_closed';
}

// budget=low tolerates priceLevel up to 2/5, medium up to 4/5, high anything.
const BUDGET_MAX_PRICE_LEVEL: Record<BudgetLevel, number> = {
  [BudgetLevel.LOW]: 2,
  [BudgetLevel.MEDIUM]: 4,
  [BudgetLevel.HIGH]: 5,
};

function checkPriceLevel(
  priceLevel: number | null | undefined,
  budgetLevel: BudgetLevel | undefined,
): PriceLevelCheck {
  if (priceLevel == null) return 'no_data';
  if (!budgetLevel) return 'ok';
  return priceLevel <= BUDGET_MAX_PRICE_LEVEL[budgetLevel]
    ? 'ok'
    : 'possibly_over_budget';
}

// Best-effort keyword lists — Activity has no structured dietary field, so
// this only catches an explicit mention in type/name/notes. A restaurant
// that's actually vegan-friendly but doesn't say so in its data is missed;
// this is a debugging signal, not a guarantee.
const DIETARY_KEYWORDS: Record<string, string[]> = {
  vegetarian: ['vegetarian', 'vegetariano', 'vegetariana'],
  vegan: ['vegan', 'vegano', 'vegana'],
  'gluten-free': [
    'gluten-free',
    'gluten free',
    'sin gluten',
    'celiac',
    'celíaco',
  ],
  'dairy-free': ['dairy-free', 'dairy free', 'sin lactosa', 'lactose-free'],
  halal: ['halal'],
  kosher: ['kosher'],
};

function checkDietaryRestrictions(
  activities: AuditActivityInput[],
  dietaryRestrictions: string[] | undefined,
): DietaryAuditFinding | undefined {
  if (!dietaryRestrictions?.length) return undefined;

  const haystack = activities
    .map((a) => `${a.type || ''} ${a.activityName} ${a.notes || ''}`)
    .join(' ')
    .toLowerCase();

  const satisfied = dietaryRestrictions.every((restriction) => {
    const keywords = DIETARY_KEYWORDS[restriction.toLowerCase()] || [
      restriction.toLowerCase(),
    ];
    return keywords.some((kw) => haystack.includes(kw));
  });

  return {
    requested: dietaryRestrictions,
    satisfied,
    limitation:
      'Best-effort keyword match over activity type/name/notes — Activity has no structured dietary field, so this can miss a genuinely compatible place that just does not mention the restriction in its data.',
  };
}

export function auditGeneration(
  activities: AuditActivityInput[],
  options: {
    budgetLevel?: BudgetLevel;
    dietaryRestrictions?: string[];
  },
): GenerationAuditResult {
  const perActivity: AuditFinding[] = activities.map((act) => ({
    activityId: act.activityId,
    activityName: act.activityName,
    openingHoursCheck: checkOpeningHours(
      act.startTime,
      act.openingHoursWeekdayText,
    ),
    priceLevelCheck: checkPriceLevel(act.priceLevel, options.budgetLevel),
  }));

  return {
    perActivity,
    dietary: checkDietaryRestrictions(activities, options.dietaryRestrictions),
  };
}
