package tours

import (
	"regexp"
	"strconv"
	"strings"
)

// AuditActivityInput mirrors AuditActivityInput (utils/generation-audit.util.ts).
type AuditActivityInput struct {
	ActivityID              string
	ActivityName            string
	StartTime               string // raw "HH:MM" as returned by the AI
	Type                    string
	Notes                   string
	OpeningHoursWeekdayText []string
	PriceLevel              *int
}

type OpeningHoursCheck string

const (
	OpeningHoursOK             OpeningHoursCheck = "ok"
	OpeningHoursPossiblyClosed OpeningHoursCheck = "possibly_closed"
	OpeningHoursNoData         OpeningHoursCheck = "no_data"
)

type PriceLevelCheck string

const (
	PriceLevelOK                 PriceLevelCheck = "ok"
	PriceLevelPossiblyOverBudget PriceLevelCheck = "possibly_over_budget"
	PriceLevelNoData             PriceLevelCheck = "no_data"
)

type AuditFinding struct {
	ActivityID        string            `json:"activityId,omitempty"`
	ActivityName      string            `json:"activityName"`
	OpeningHoursCheck OpeningHoursCheck `json:"openingHoursCheck"`
	PriceLevelCheck   PriceLevelCheck   `json:"priceLevelCheck"`
}

type DietaryAuditFinding struct {
	Requested  []string `json:"requested"`
	Satisfied  bool     `json:"satisfied"`
	Limitation string   `json:"limitation"`
}

type GenerationAuditResult struct {
	PerActivity []AuditFinding       `json:"perActivity"`
	Dietary     *DietaryAuditFinding `json:"dietary,omitempty"`
}

var (
	pattern24h = regexp.MustCompile(`(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})`)
	pattern12h = regexp.MustCompile(`(?i)(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)`)
	hhmmPrefix = regexp.MustCompile(`^(\d{1,2}):(\d{2})`)
)

// extractTimeRangesInMinutes ports the function of the same name. Known
// limitation, carried over from the original: this does NOT match ranges
// to a specific weekday, since a tour's dayNumber doesn't reliably map to
// a real calendar weekday here — an activity is checked against every
// range mentioned for the place, which can produce false negatives but not
// false positives from a fabricated schedule.
func extractTimeRangesInMinutes(text string) [][2]int {
	var ranges [][2]int

	for _, m := range pattern24h.FindAllStringSubmatch(text, -1) {
		ranges = append(ranges, [2]int{atoi(m[1])*60 + atoi(m[2]), atoi(m[3])*60 + atoi(m[4])})
	}

	to24h := func(h, meridiem string) int {
		hours := atoi(h) % 12
		if strings.EqualFold(meridiem, "PM") {
			hours += 12
		}
		return hours
	}
	for _, m := range pattern12h.FindAllStringSubmatch(text, -1) {
		ranges = append(ranges, [2]int{
			to24h(m[1], m[3])*60 + atoi(m[2]),
			to24h(m[4], m[6])*60 + atoi(m[5]),
		})
	}

	return ranges
}

func parseHHMMToMinutes(startTime string) (int, bool) {
	m := hhmmPrefix.FindStringSubmatch(strings.TrimSpace(startTime))
	if m == nil {
		return 0, false
	}
	return atoi(m[1])*60 + atoi(m[2]), true
}

func checkOpeningHours(startTime string, weekdayText []string) OpeningHoursCheck {
	if startTime == "" || len(weekdayText) == 0 {
		return OpeningHoursNoData
	}
	startMinutes, ok := parseHHMMToMinutes(startTime)
	if !ok {
		return OpeningHoursNoData
	}
	ranges := extractTimeRangesInMinutes(strings.Join(weekdayText, "; "))
	if len(ranges) == 0 {
		return OpeningHoursNoData
	}
	for _, r := range ranges {
		if startMinutes >= r[0] && startMinutes <= r[1] {
			return OpeningHoursOK
		}
	}
	return OpeningHoursPossiblyClosed
}

// budgetMaxPriceLevel: budget=low tolerates priceLevel up to 2/5, medium up to 4/5, high anything.
var budgetMaxPriceLevel = map[BudgetLevel]int{
	BudgetLevelLow:    2,
	BudgetLevelMedium: 4,
	BudgetLevelHigh:   5,
}

func checkPriceLevel(priceLevel *int, budgetLevel *BudgetLevel) PriceLevelCheck {
	if priceLevel == nil {
		return PriceLevelNoData
	}
	if budgetLevel == nil {
		return PriceLevelOK
	}
	if *priceLevel <= budgetMaxPriceLevel[*budgetLevel] {
		return PriceLevelOK
	}
	return PriceLevelPossiblyOverBudget
}

// dietaryKeywords: best-effort keyword lists — Activity has no structured
// dietary field, so this only catches an explicit mention in type/name/notes.
var dietaryKeywords = map[string][]string{
	"vegetarian":  {"vegetarian", "vegetariano", "vegetariana"},
	"vegan":       {"vegan", "vegano", "vegana"},
	"gluten-free": {"gluten-free", "gluten free", "sin gluten", "celiac", "celíaco"},
	"dairy-free":  {"dairy-free", "dairy free", "sin lactosa", "lactose-free"},
	"halal":       {"halal"},
	"kosher":      {"kosher"},
}

func checkDietaryRestrictions(activities []AuditActivityInput, dietaryRestrictions []string) *DietaryAuditFinding {
	if len(dietaryRestrictions) == 0 {
		return nil
	}

	var haystackParts []string
	for _, a := range activities {
		haystackParts = append(haystackParts, a.Type+" "+a.ActivityName+" "+a.Notes)
	}
	haystack := strings.ToLower(strings.Join(haystackParts, " "))

	satisfied := true
	for _, restriction := range dietaryRestrictions {
		keywords, ok := dietaryKeywords[strings.ToLower(restriction)]
		if !ok {
			keywords = []string{strings.ToLower(restriction)}
		}
		matched := false
		for _, kw := range keywords {
			if strings.Contains(haystack, kw) {
				matched = true
				break
			}
		}
		if !matched {
			satisfied = false
			break
		}
	}

	return &DietaryAuditFinding{
		Requested: dietaryRestrictions,
		Satisfied: satisfied,
		Limitation: "Best-effort keyword match over activity type/name/notes — Activity has no structured dietary field, " +
			"so this can miss a genuinely compatible place that just does not mention the restriction in its data.",
	}
}

// AuditGeneration ports auditGeneration: deterministic evidence for the
// debug panel — checks the AI's own picks against the real data it was
// given (opening hours, price level), rather than trusting its
// self-reported reasoning.
func AuditGeneration(activities []AuditActivityInput, budgetLevel *BudgetLevel, dietaryRestrictions []string) GenerationAuditResult {
	perActivity := make([]AuditFinding, len(activities))
	for i, act := range activities {
		perActivity[i] = AuditFinding{
			ActivityID:        act.ActivityID,
			ActivityName:      act.ActivityName,
			OpeningHoursCheck: checkOpeningHours(act.StartTime, act.OpeningHoursWeekdayText),
			PriceLevelCheck:   checkPriceLevel(act.PriceLevel, budgetLevel),
		}
	}

	return GenerationAuditResult{
		PerActivity: perActivity,
		Dietary:     checkDietaryRestrictions(activities, dietaryRestrictions),
	}
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
