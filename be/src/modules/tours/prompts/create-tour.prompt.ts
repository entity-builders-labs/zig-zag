// Strict JSON Schema used by Groq GPT-OSS structured outputs. Every property
// is required and every object forbids additional properties because those are
// constraints of Groq's `strict: true` mode. Fields that are conceptually
// optional are represented by empty arrays (for example selectedWaypointIds
// and compositeActivities).
export const CREATE_TOUR_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    reasoning: { type: 'string' },
    estimatedDuration: { type: 'number' },
    activities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          activityId: { type: 'string' },
          activityName: { type: 'string' },
          type: { type: 'string' },
          dayNumber: { type: 'number' },
          startTime: { type: 'string' },
          duration: { type: 'number' },
          travelTimeToNext: { type: 'number' },
          distanceToNext: { type: 'number' },
          notes: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          selectedWaypointIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'activityId',
          'activityName',
          'type',
          'dayNumber',
          'startTime',
          'duration',
          'travelTimeToNext',
          'distanceToNext',
          'notes',
          'latitude',
          'longitude',
          'selectedWaypointIds',
        ],
      },
    },
    compositeActivities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['NEIGHBORHOOD_WALK', 'ROUTE', 'EXPERIENCE'],
          },
          variantTheme: { type: 'string' },
          themeReasoning: { type: 'string' },
          areaId: { type: 'string' },
          dayNumber: { type: 'number' },
          startTime: { type: 'string' },
          waypointIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'name',
          'kind',
          'variantTheme',
          'themeReasoning',
          'areaId',
          'dayNumber',
          'startTime',
          'waypointIds',
        ],
      },
    },
    totalDays: { type: 'number' },
    totalDistance: { type: 'number' },
    estimatedBudget: { type: 'number' },
    recommendedGroupSize: { type: 'number' },
    activitiesLatLng: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lat: { type: 'number' },
          lng: { type: 'number' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  required: [
    'title',
    'description',
    'reasoning',
    'estimatedDuration',
    'activities',
    'compositeActivities',
    'totalDays',
    'totalDistance',
    'estimatedBudget',
    'recommendedGroupSize',
    'activitiesLatLng',
  ],
};

export const CREATE_TOUR_SYSTEM_PROMPT = `You are a tour planning expert. Create well-organized tour itineraries by:
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

CRITICAL: Only use activities from the "Available activities" list below — every
activity you include MUST be one of these, copied with its exact id, name, and
coordinates. Do NOT invent, imagine, or add any place that is not in this list,
even if the list is short or doesn't perfectly match every interest. If the list
is empty, do not produce any activities.

You may ALSO propose composite experiences (a themed neighborhood walk, a
scenic route, or a multi-stop experience) in "compositeActivities", alongside
(not instead of) your flat activity picks above. CRITICAL: every waypointId in
a composite must be copied exactly from the "Available activities" list or the
"Available OSM features" list — never invented. "kind" must be one of
NEIGHBORHOOD_WALK, ROUTE, or EXPERIENCE. "variantTheme" must be one of the
themes listed under "Available themes". "areaId" must be copied exactly from
"Available area" — never invented, and omitted entirely if no area was offered.
If no coherent composite can be assembled from real candidates, omit
compositeActivities (or return it empty) — never fabricate one to fill it.

Also provide a "reasoning" field (3-5 sentences) explaining how you weighed the
requested budget, transportation mode, travel pace, dietary restrictions, and
group type when choosing and ordering activities, and why any candidates were
left out. This is for internal debugging only, not shown to the end user — be
concrete and reference the actual preferences and candidates, not generic
statements.

Available activities: {activities}
Available OSM features (streets/boundaries for composite walks): {osmFeatures}
Available area: {area}
Available themes: {themes}`;

export const CREATE_TOUR_JSON_SYSTEM_PROMPT = `You are a tour planning expert. Create well-organized tour itineraries by:
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

You may ALSO propose composite experiences (a themed neighborhood walk, a
scenic route, or a multi-stop experience) in "compositeActivities", alongside
(not instead of) your flat "activities" picks. CRITICAL: every waypointId in a
composite must be copied exactly from "Available activities" or "Available OSM
features" in the user message — never invented. "kind" must be one of
NEIGHBORHOOD_WALK, ROUTE, or EXPERIENCE. "variantTheme" must be one of
"Available themes". "areaId" must be copied exactly from "Available area" —
never invented, and composites must be omitted entirely if no area was
offered. If no coherent composite can be assembled from real candidates,
return an empty "compositeActivities" array — never fabricate one to fill it.

Also fill "reasoning" (3-5 sentences) explaining how you weighed the requested
budget, transportation mode, travel pace, dietary restrictions, and group type
when choosing and ordering activities, and why any candidates were left out.
This is for internal debugging only, not shown to the end user — be concrete
and reference the actual preferences and candidates, not generic statements.

IMPORTANT: You must return ONLY valid JSON, no markdown, no code blocks, just pure JSON.

Return a JSON object with this exact structure:
{{
  "title": "string",
  "description": "string",
  "reasoning": "string (3-5 sentences, see instructions above)",
  "estimatedDuration": number,
  "activities": [
    {{
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
      "longitude": number,
      "selectedWaypointIds": "string[] (OPTIONAL — only if activityId refers to an existing composite/variant and the context justifies using a subset of its own waypoints, e.g. excluding a stop for a family with kids. Every id here must belong to that variant's own waypoints.)"
    }}
  ],
  "compositeActivities": [
    {{
      "name": "string",
      "kind": "NEIGHBORHOOD_WALK | ROUTE | EXPERIENCE",
      "variantTheme": "string (one of Available themes)",
      "themeReasoning": "string (why this composite makes sense here, 1-3 sentences)",
      "areaId": "string (REQUIRED — must exactly match Available area)",
      "dayNumber": number,
      "startTime": "string (HH:MM format)",
      "waypointIds": "string[] (REQUIRED — every id copied exactly from Available activities or Available OSM features)"
    }}
  ],
  "totalDays": number,
  "totalDistance": number,
  "estimatedBudget": number,
  "recommendedGroupSize": number,
  "activitiesLatLng": [
    {{
      "lat": number,
      "lng": number
    }}
  ]
}}`;

export const createTourJsonUserPrompt = (
  input: string,
  activities: string,
  osmFeatures: string = '',
  area: string = '',
  themes: string = '',
) => `${input}

Available activities: ${activities || 'No specific activities provided. Create a general tour.'}
Available OSM features (streets/boundaries for composite walks): ${osmFeatures || 'None available.'}
Available area: ${area || 'None available — omit compositeActivities entirely if this is empty.'}
Available themes: ${themes || 'None available.'}

Remember: Return ONLY valid JSON, no markdown formatting, no code blocks.`;
