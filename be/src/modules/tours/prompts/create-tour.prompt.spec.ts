import { CREATE_TOUR_RESPONSE_SCHEMA } from './create-tour.prompt';

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

  it('keeps identity and anti-hallucination fields in the structured contract', () => {
    const schema = CREATE_TOUR_RESPONSE_SCHEMA as any;
    const activity = schema.properties.activities.items;
    const composite = schema.properties.compositeActivities.items;

    expect(activity.required).toEqual(
      expect.arrayContaining(['activityId', 'selectedWaypointIds']),
    );
    expect(composite.required).toEqual(
      expect.arrayContaining(['areaId', 'waypointIds']),
    );
    expect(composite.properties.kind.enum).toEqual([
      'NEIGHBORHOOD_WALK',
      'ROUTE',
      'EXPERIENCE',
    ]);
  });
});
