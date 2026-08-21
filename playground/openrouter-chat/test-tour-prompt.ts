// Sandbox for iterating on the real tour-generation prompt without spinning
// up the full backend (no Postgres, no ChromaDB, no Google Places crawl).
//
// This imports the actual prompt + JSON-cleanup utilities straight from the
// backend source (they're plain functions with zero NestJS dependencies),
// so editing be/src/modules/tours/prompts/create-tour.prompt.ts is picked
// up here automatically — no copy-pasting the prompt text.
import { OpenRouter } from '@openrouter/sdk';
import type { ChatResult } from '@openrouter/sdk/models';
import {
  CREATE_TOUR_JSON_SYSTEM_PROMPT,
  createTourJsonUserPrompt,
} from '../../be/src/modules/tours/prompts/create-tour.prompt';
import { extractAndCleanJson, repairJson } from '../../be/src/modules/tours/utils/json-parser.util';
import { buildPromptFromParams } from '../../be/src/modules/tours/utils/prompt-builder.util';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error(
    'Missing OPENROUTER_API_KEY. Create one at https://openrouter.ai/settings/keys ' +
      'and run: OPENROUTER_API_KEY=sk-or-v1-... npx tsx test-tour-prompt.ts',
  );
  process.exit(1);
}

const client = new OpenRouter({ apiKey });

// Change only this string to compare how different models follow the JSON
// instructions and the "don't invent activities" constraint.
const MODEL = 'google/gemini-3.1-flash-lite';

// Stand-in for what generateTourActivities() builds from real DB rows —
// same "id: ... - name (type) - description - Location: lat, lng -
// Duration: N minutes" format, just hand-written instead of queried.
const sampleActivities = [
  {
    id: 'act_1',
    name: 'Caminito',
    type: 'Landmark',
    description: 'Colorful open-air museum street in La Boca',
    latitude: -34.6382,
    longitude: -58.3629,
    duration: 60,
  },
  {
    id: 'act_2',
    name: 'El Zanjón de Granados',
    type: 'Museum',
    description: 'Underground tunnels and historic ruins beneath San Telmo',
    latitude: -34.6172,
    longitude: -58.3731,
    duration: 90,
  },
  {
    id: 'act_3',
    name: 'Mercado de San Telmo',
    type: 'Market',
    description: 'Antiques, food stalls and local crafts in a historic market hall',
    latitude: -34.6188,
    longitude: -58.3722,
    duration: 45,
  },
  {
    id: 'act_4',
    name: 'Plaza Dorrego',
    type: 'Park',
    description: 'Cobblestone square known for weekend tango and antique fairs',
    latitude: -34.6196,
    longitude: -58.3715,
    duration: 30,
  },
];

const availableActivitiesText = `\n\nAvailable activities in the area (within 5km):\n${sampleActivities
  .map(
    (act) =>
      `id: ${act.id} - ${act.name} (${act.type}) - ${act.description} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration} minutes`,
  )
  .join('\n')}`;

// --- Experiment toggle -----------------------------------------------------
// The real backend NEVER lets the model pick its own activities — it only
// accepts places from a pre-fetched, real (DB/Google Places) candidate list,
// and verifyAndDedupeActivities() in tour-activity-generation.service.ts
// throws away anything the model returns that isn't in that list. That's a
// deliberate anti-hallucination guardrail, not an oversight.
//
// Flip this to `true` to see what happens WITHOUT that guardrail — i.e. the
// model has to name real venues purely from its own training knowledge, with
// no ground truth to check against. Expect confident-sounding places that
// may not exist, wrong coordinates, or venues that closed years ago. This
// only exists here in the sandbox; be/ is untouched.
const LET_AI_PICK_ACTIVITIES = true;

// Sandbox-only prompt — doesn't exist in be/. Same JSON contract as
// CREATE_TOUR_JSON_SYSTEM_PROMPT, minus the "only use the provided list"
// constraint (there's no list to constrain it to).
const FREEFORM_SYSTEM_PROMPT = `You are a tour planning expert. Create well-organized tour itineraries by:
- Following a logical geographical sequence
- Progressing naturally throughout the day
- Considering operational hours
- Including reasonable transition times
- Creating balanced activity type mixes

For each activity, provide detailed notes that include:
- What visitors can expect to see or experience
- Key highlights and points of interest
- Practical tips (best photo spots, recommended items to bring, etc.)
- Any relevant historical or cultural context
- Specific recommendations based on the activity type

You have NOT been given a list of activities. Use your own knowledge to pick
real, existing places that match the destination and interests below. Do not
invent a place if you are not confident it actually exists — prefer fewer,
well-known real activities over filling the itinerary with fabricated ones.

IMPORTANT: You must return ONLY valid JSON, no markdown, no code blocks, just pure JSON.

Return a JSON object with this exact structure:
{
  "title": "string",
  "description": "string",
  "estimatedDuration": number,
  "activities": [
    {
      "activityId": "string (make up a slug, e.g. \\"caminito\\")",
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
    { "lat": number, "lng": number }
  ]
}`;

// Simulates a real wizard submission — same fields TourWizardForm.tsx puts
// in GenerateTourDto (fe/components/tours/TourWizardForm.tsx handleSubmit()).
// `days` is included here even though buildPromptFromParams() below never
// reads it — that's real: the wizard collects day count and start dates,
// but neither ever reaches the LLM prompt text (see the note above main()).
const wizardSubmission = {
  destination: 'San Telmo, Buenos Aires',
  destinationLatitude: -34.6206,
  destinationLongitude: -58.3731,
  days: 1,
  budgetLevel: 'medium',
  transportationMode: ['walking', 'public_transport'],
  travelPace: 'moderate',
  groupType: 'couple',
  // Post-INTEREST_MAP English values — the wizard UI shows Spanish labels
  // and translates them before this point.
  interests: ['history', 'art', 'food'],
};

// Mirrors TourGenerationService.createTourFromWizard(): the wizard never
// sets `name`, so promptName falls back to `destination`.
const promptName = wizardSubmission.destination;

// This is the exact function the real backend calls — same import as
// tour-generation.service.ts uses.
const finalPrompt = buildPromptFromParams({
  name: promptName,
  interests: wizardSubmission.interests,
  budgetLevel: wizardSubmission.budgetLevel,
  transportationMode: wizardSubmission.transportationMode,
  travelPace: wizardSubmission.travelPace,
  groupType: wizardSubmission.groupType,
  latitude: wizardSubmission.destinationLatitude,
  longitude: wizardSubmission.destinationLongitude,
  destination: wizardSubmission.destination,
});

// generateTourActivities() does `metadata.originalPrompt || metadata.enhancedPrompt`
// — the wizard path never sets enhancedPrompt, so this is just finalPrompt.
const enhancedPrompt = finalPrompt;

async function main() {
  // Constrained mode sends the real candidate list; freeform mode sends only
  // the wizard preferences and lets the model name its own activities.
  const systemPrompt = LET_AI_PICK_ACTIVITIES
    ? FREEFORM_SYSTEM_PROMPT
    : CREATE_TOUR_JSON_SYSTEM_PROMPT;
  const userPrompt = LET_AI_PICK_ACTIVITIES
    ? enhancedPrompt
    : createTourJsonUserPrompt(
        enhancedPrompt + availableActivitiesText,
        availableActivitiesText,
      );

  console.log(`Model: ${MODEL}`);
  console.log(
    `Mode: ${LET_AI_PICK_ACTIVITIES ? 'FREEFORM (no candidate list — model picks activities itself)' : 'CONSTRAINED (real candidate list provided)'}\n`,
  );
  console.log('--- Full prompt sent to the LLM ---');
  console.log('[system]');
  console.log(systemPrompt);
  console.log('\n[user]');
  console.log(userPrompt);
  console.log('---\n');

  // Same overload-narrowing caveat as chat.ts: assert the non-streaming
  // shape since we passed stream: false.
  const result = (await client.chat.send({
    chatRequest: {
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      // Cap output so a free-tier balance can cover the request (see
      // chat.ts for why) — 2000 is generous enough for a JSON tour with a
      // handful of activities.
      maxTokens: 2000,
    },
  })) as ChatResult;

  const raw = result.choices[0]?.message.content;
  const text = typeof raw === 'string' ? raw : '';

  console.log('--- Raw response ---');
  console.log(text);

  console.log('\n--- Parsed tour ---');
  try {
    const cleaned = extractAndCleanJson(text);
    let tour;
    try {
      tour = JSON.parse(cleaned);
    } catch {
      tour = JSON.parse(repairJson(cleaned));
    }

    console.log(`Title: ${tour.title}`);
    console.log(`Description: ${tour.description}`);
    console.log(`Activities (${tour.activities?.length ?? 0}):`);
    for (const a of tour.activities ?? []) {
      // In freeform mode there's no candidate list to check against — every
      // activity is unverified by construction. This is exactly the check
      // the real backend's verifyAndDedupeActivities() does, and exactly
      // what it can no longer do once you remove the candidate list.
      const status = LET_AI_PICK_ACTIVITIES
        ? 'UNVERIFIED'
        : sampleActivities.some((s) => s.id === a.activityId)
          ? 'OK'
          : 'HALLUCINATED';
      console.log(
        `  ${status}  day ${a.dayNumber} ${a.startTime} — ${a.activityName ?? a.activityId} (${a.latitude}, ${a.longitude})`,
      );
    }
  } catch (err) {
    console.error('Failed to parse JSON from model response:', err);
  }

  if (result.usage) {
    console.log(
      `\nTokens — prompt: ${result.usage.promptTokens}, completion: ${result.usage.completionTokens}, total: ${result.usage.totalTokens}`,
    );
  }
}

main();
