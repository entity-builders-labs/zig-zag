import { TOUR_PLANNING_POLICY_PROMPT } from './tour-planning-policy.prompt';

// Strict JSON Schema used by Groq GPT-OSS structured outputs. Every property
// is required and every object forbids additional properties because those are
// constraints of Groq's `strict: true` mode. Fields that are conceptually
// optional are represented by empty arrays (for example selectedWaypointIds).
// Groq's on-demand tier accounts for prompt + max completion tokens against
// its TPM limit. Reserving 8192 completion tokens made every non-empty tour
// request exceed an 8000 TPM allowance before generation even started. The
// candidate windows are bounded and a normal structured tour fits inside this
// output budget while leaving room for the system prompt and JSON schema.
export const GROQ_TOUR_MAX_COMPLETION_TOKENS = 3000;

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
    'totalDays',
    'totalDistance',
    'estimatedBudget',
    'recommendedGroupSize',
    'activitiesLatLng',
  ],
};

// Compact contract used by the background activity-selection pipeline. The
// Tour already exists at this point, and canonical activity identity,
// coordinates, travel distance and travel time all come from verified server
// data. Asking the LLM to repeat them wastes the bounded Groq completion budget
// and can truncate long multi-day responses before required fields are closed.
export const CREATE_TOUR_SELECTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    activities: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          activityId: { type: 'string' },
          dayNumber: { type: 'number' },
          startTime: { type: 'string' },
          duration: { type: 'number' },
          notes: { type: 'string', maxLength: 160 },
          selectedWaypointIds: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string' },
          },
        },
        required: [
          'activityId',
          'dayNumber',
          'startTime',
          'duration',
          'notes',
          'selectedWaypointIds',
        ],
      },
    },
  },
  required: ['reasoning', 'activities'],
};

export const CREATE_TOUR_SELECTION_JSON_SYSTEM_PROMPT = `${TOUR_PLANNING_POLICY_PROMPT}

OUTPUT CONTRACT (compact selection)

Return exactly two top-level fields: reasoning and activities.

For activities:
- Copy activityId exactly from Available activities. Never invent or alter an ID.
- Return only activityId, dayNumber, startTime, duration, notes, and selectedWaypointIds.
- notes must be one short sentence (maximum 12 words) based only on supplied candidate data.
- Do not return names, types, coordinates, distances, or travel times; the server owns those values.
- selectedWaypointIds must be empty unless selecting a verified subset of an existing composite.

reasoning must be at most two short sentences. Do not claim verified opening hours, prices, transport services, or facts absent from the candidates.

Return only valid JSON matching the supplied schema.`;

// Explicit offline curation contract used only by generate-templates. Live
// tour generation never receives this schema and cannot create composites.
export const CREATE_COMPOSITE_PROPOSAL_RESPONSE_SCHEMA: Record<
  string,
  unknown
> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reasoning: { type: 'string', maxLength: 400 },
    compositeActivities: {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 120 },
          kind: {
            type: 'string',
            enum: ['NEIGHBORHOOD_WALK', 'ROUTE', 'EXPERIENCE'],
          },
          variantTheme: { type: 'string' },
          themeReasoning: { type: 'string', maxLength: 200 },
          areaId: { type: 'string' },
          dayNumber: { type: 'number' },
          startTime: { type: 'string' },
          waypointIds: {
            type: 'array',
            maxItems: 12,
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
    activities: { type: 'array', maxItems: 0 },
  },
  required: ['reasoning', 'compositeActivities', 'activities'],
};

export const CREATE_COMPOSITE_PROPOSAL_JSON_SYSTEM_PROMPT = `You propose one composite Activity for an explicit offline curation command.

Return exactly three top-level fields: reasoning, compositeActivities, and activities.
- Return activities as an empty array.
- Every areaId and waypointId must be copied exactly from the supplied candidates.
- Never mix waypoint areaIds or invent an entity.
- Return an empty compositeActivities array when evidence is insufficient.
- reasoning and themeReasoning must each be short.

Return only valid JSON matching the supplied schema.`;

export const CREATE_TOUR_SYSTEM_PROMPT = `${TOUR_PLANNING_POLICY_PROMPT}

OUTPUT CONTRACT (OpenAI function-calling)

For each activity, provide detailed notes that include:
- What visitors can expect to see or experience
- Key highlights and points of interest
- Practical tips (best photo spots, recommended items to bring, etc.)
- Any relevant historical or cultural context
- Specific recommendations based on the activity type

When citing an activity, copy its exact id, name, and coordinates from the
Available activities list below.

Also provide a "reasoning" field (3-5 sentences) explaining how you weighed the
requested budget, transportation mode, travel pace, dietary restrictions, and
group type when choosing and ordering activities, and why any candidates were
left out. This is for internal debugging only, not shown to the end user.

Available activities: {activities}`;

export const CREATE_TOUR_JSON_SYSTEM_PROMPT = `${TOUR_PLANNING_POLICY_PROMPT}

OUTPUT CONTRACT (full JSON, legacy /tours/nearby fallback)

For each activity, provide detailed notes that include:
- What visitors can expect to see or experience
- Key highlights and points of interest
- Practical tips (best photo spots, recommended items to bring, etc.)
- Any relevant historical or cultural context
- Specific recommendations based on the activity type

When citing an activity in this schema, copy its exact id (into "activityId"),
name, and coordinates from the Available activities list.

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
) => `${input}

Available activities: ${activities || 'No specific activities provided. Create a general tour.'}

Remember: Return ONLY valid JSON, no markdown formatting, no code blocks.`;

export const createCompositeProposalJsonUserPrompt = (
  input: string,
  activities: string,
  osmFeatures: string,
  area: string,
  themes: string,
) => `${input}

Available activities: ${activities || 'None available.'}
Available OSM features: ${osmFeatures || 'None available.'}
Available areas: ${area || 'None available.'}
Available themes: ${themes || 'None available.'}

Remember: Return ONLY valid JSON, no markdown formatting, no code blocks.`;
