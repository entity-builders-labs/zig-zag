package tours

import "fmt"

// ActivityForPrompt mirrors ActivityForPrompt (utils/activity-prompt-formatter.util.ts).
type ActivityForPrompt struct {
	ID                  string
	Name                string
	Type                string
	Description         string
	Latitude, Longitude float64
	Duration            *float64
	Rating              *float64
	RatingCount         *int
	PriceLevel          *int
	OpeningHoursWeekday []string
}

// FormatActivityForPrompt ports formatActivityForPrompt: one line of the
// "Available activities" list sent to the AI — every signal here is real
// data the model can weigh, not something it has to guess at.
func FormatActivityForPrompt(a ActivityForPrompt) string {
	activityType := a.Type
	if activityType == "" {
		activityType = "Activity"
	}
	description := a.Description
	if description == "" {
		description = "No description"
	}
	if len(description) > 100 {
		description = description[:100]
	}
	duration := "Unknown"
	if a.Duration != nil {
		duration = fmt.Sprintf("%g", *a.Duration)
	}

	parts := []string{
		fmt.Sprintf("id: %s", a.ID),
		fmt.Sprintf("%s (%s)", a.Name, activityType),
		description,
		fmt.Sprintf("Location: %g, %g", a.Latitude, a.Longitude),
		fmt.Sprintf("Duration: %s minutes", duration),
	}

	if a.Rating != nil {
		reviews := ""
		if a.RatingCount != nil {
			reviews = fmt.Sprintf(" (%d reviews)", *a.RatingCount)
		}
		parts = append(parts, fmt.Sprintf("Rating: %g/5%s", *a.Rating, reviews))
	}
	if a.PriceLevel != nil {
		parts = append(parts, fmt.Sprintf("Price level: %d/5", *a.PriceLevel))
	}
	if len(a.OpeningHoursWeekday) > 0 {
		joined := ""
		for i, w := range a.OpeningHoursWeekday {
			if i > 0 {
				joined += "; "
			}
			joined += w
		}
		parts = append(parts, "Opening hours: "+joined)
	}

	out := parts[0]
	for _, p := range parts[1:] {
		out += " - " + p
	}
	return out
}

// createTourJSONSystemPrompt / createTourJSONUserPrompt port
// CREATE_TOUR_JSON_SYSTEM_PROMPT / createTourJsonUserPrompt
// (prompts/create-tour.prompt.ts) — the freeform-JSON-mode path, which is
// the one that actually matters given this project's real config
// (AI_PROVIDER=groq). The OpenAI function-calling variant
// (CREATE_TOUR_SYSTEM_PROMPT + JsonOutputFunctionsParser) isn't ported:
// it's dead code under the actual configuration, and go-openai's
// tool-calling API would need its own separate wiring to support it later
// if the provider ever changes.
const createTourJSONSystemPrompt = `You are a tour planning expert. Create well-organized tour itineraries by:
- Following a logical geographical sequence
- Progressing naturally throughout the day
- Scheduling each activity within its listed opening hours when available —
  never schedule a visit at a time the place is marked closed
- Including reasonable transition times
- Creating balanced activity type mixes
- Preferring higher-rated activities (and more reviews as a confidence signal)
  when several options fit equally well, and using price level as a practical
  tie-breaker — but never let rating or price override a poor match with the
  requested interests

For each activity, provide detailed notes that include:
- What visitors can expect to see or experience
- Key highlights and points of interest
- Practical tips (best photo spots, recommended items to bring, etc.)
- Any relevant historical or cultural context
- Specific recommendations based on the activity type

CRITICAL: Only use activities from the "Available activities" list in the user
message — every activity you include MUST be one of these, copied with its
exact id (into "activityId"), name, and coordinates. Do NOT invent, imagine, or
add any place that is not explicitly listed there, even if the list is short or
doesn't perfectly match every interest. If the list is empty, return an empty
"activities" array — never fabricate a place to fill it.

Also fill "reasoning" (3-5 sentences) explaining how you weighed the requested
budget, transportation mode, travel pace, dietary restrictions, and group type
when choosing and ordering activities, and why any candidates were left out.
This is for internal debugging only, not shown to the end user — be concrete
and reference the actual preferences and candidates, not generic statements.

IMPORTANT: You must return ONLY valid JSON, no markdown, no code blocks, just pure JSON.

Return a JSON object with this exact structure:
{
  "title": "string",
  "description": "string",
  "reasoning": "string (3-5 sentences, see instructions above)",
  "estimatedDuration": number,
  "activities": [
    {
      "activityId": "string (REQUIRED — must exactly match the id of one of the Available activities)",
      "activityName": "string",
      "type": "string",
      "dayNumber": number,
      "startTime": "string (HH:MM format)",
      "duration": number,
      "travelTimeToNext": number,
      "distanceToNext": number,
      "notes": "string (detailed notes about the activity)",
      "latitude": number,
      "longitude": number
    }
  ],
  "totalDays": number,
  "totalDistance": number,
  "estimatedBudget": number,
  "recommendedGroupSize": number,
  "activitiesLatLng": [
    {
      "lat": number,
      "lng": number
    }
  ]
}`

func createTourJSONUserPrompt(input, activities string) string {
	if activities == "" {
		activities = "No specific activities provided. Create a general tour."
	}
	return input + "\n\nAvailable activities: " + activities + "\n\nRemember: Return ONLY valid JSON, no markdown formatting, no code blocks."
}
