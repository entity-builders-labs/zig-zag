import {
  CREATE_COMPOSITE_PROPOSAL_RESPONSE_SCHEMA,
  CREATE_TOUR_JSON_SYSTEM_PROMPT,
  CREATE_TOUR_RESPONSE_SCHEMA,
  CREATE_TOUR_SELECTION_JSON_SYSTEM_PROMPT,
  CREATE_TOUR_SELECTION_RESPONSE_SCHEMA,
  CREATE_TOUR_SYSTEM_PROMPT,
} from './create-tour.prompt';
import { TOUR_PLANNING_POLICY_PROMPT } from './tour-planning-policy.prompt';

function expectStrictObjects(schema: any): void {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type === 'object') {
    expect(schema.additionalProperties).toBe(false);
    const propertyNames = Object.keys(schema.properties ?? {}).sort();
    expect([...(schema.required ?? [])].sort()).toEqual(propertyNames);
    Object.values(schema.properties ?? {}).forEach(expectStrictObjects);
  }

  if (schema.type === 'array') {
    expectStrictObjects(schema.items);
  }
}

describe('CREATE_TOUR_RESPONSE_SCHEMA', () => {
  it('meets the recursive object constraints required by Groq strict mode', () => {
    expectStrictObjects(CREATE_TOUR_RESPONSE_SCHEMA);
  });

  it('keeps identity and waypoint-subset verification in the selection contract', () => {
    const schema = CREATE_TOUR_RESPONSE_SCHEMA as any;
    const activity = schema.properties.activities.items;

    expect(activity.required).toEqual(
      expect.arrayContaining(['activityId', 'selectedWaypointIds']),
    );
    expect(schema.properties).not.toHaveProperty('compositeActivities');
  });
});

describe('CREATE_TOUR_SELECTION_RESPONSE_SCHEMA', () => {
  it('meets the recursive object constraints required by Groq strict mode', () => {
    expectStrictObjects(CREATE_TOUR_SELECTION_RESPONSE_SCHEMA);
  });

  it('returns only selection fields and leaves canonical data to the server', () => {
    const schema = CREATE_TOUR_SELECTION_RESPONSE_SCHEMA as any;
    const activity = schema.properties.activities.items;

    expect(schema.required).toEqual(['reasoning', 'activities']);
    expect(schema.properties).not.toHaveProperty('compositeActivities');
    expect(schema.properties).not.toHaveProperty('activitiesLatLng');
    expect(schema.properties).not.toHaveProperty('totalDistance');
    expect(activity.properties).toHaveProperty('activityId');
    expect(activity.properties).toHaveProperty('selectedWaypointIds');
    expect(activity.properties).not.toHaveProperty('activityName');
    expect(activity.properties).not.toHaveProperty('latitude');
    expect(activity.properties).not.toHaveProperty('travelTimeToNext');
    expect(schema.properties.reasoning.maxLength).toBe(400);
    expect(schema.properties.activities.maxItems).toBe(30);
    expect(activity.properties.notes.maxLength).toBe(160);
  });
});

describe('shared TOUR_PLANNING_POLICY_PROMPT inclusion', () => {
  it('is included verbatim in every live itinerary-generation system prompt', () => {
    // Guards against a future edit pasting a divergent copy of the policy
    // into one prompt instead of importing the shared constant — the three
    // live paths (wizard compact selection, /tours/nearby JSON fallback,
    // and the shared OpenAI function-calling contract) must never drift.
    expect(CREATE_TOUR_SELECTION_JSON_SYSTEM_PROMPT).toContain(
      TOUR_PLANNING_POLICY_PROMPT,
    );
    expect(CREATE_TOUR_JSON_SYSTEM_PROMPT).toContain(
      TOUR_PLANNING_POLICY_PROMPT,
    );
    expect(CREATE_TOUR_SYSTEM_PROMPT).toContain(TOUR_PLANNING_POLICY_PROMPT);
  });

  it('states the real relaxed/moderate/fast pace density guidance', () => {
    expect(TOUR_PLANNING_POLICY_PROMPT).toContain('relaxed: typically 2-4');
    expect(TOUR_PLANNING_POLICY_PROMPT).toContain('moderate: typically 3-5');
    expect(TOUR_PLANNING_POLICY_PROMPT).toContain('fast: typically 4-7');
  });
});

describe('CREATE_COMPOSITE_PROPOSAL_RESPONSE_SCHEMA', () => {
  it('is isolated to the explicit offline curation contract', () => {
    expectStrictObjects(CREATE_COMPOSITE_PROPOSAL_RESPONSE_SCHEMA);
    const schema = CREATE_COMPOSITE_PROPOSAL_RESPONSE_SCHEMA as any;
    expect(schema.required).toEqual([
      'reasoning',
      'compositeActivities',
      'activities',
    ]);
    expect(schema.properties.activities.maxItems).toBe(0);
    expect(schema.properties.compositeActivities.maxItems).toBe(1);
  });
});
