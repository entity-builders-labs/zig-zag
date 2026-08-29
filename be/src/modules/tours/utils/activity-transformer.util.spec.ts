import {
  parseDuration,
  transformAiActivitiesToDto,
} from './activity-transformer.util';

describe('parseDuration', () => {
  it('passes through a real number unchanged', () => {
    expect(parseDuration(2.5)).toBe(2.5);
  });

  it('extracts the numeric value when the model wraps it with units', () => {
    // Reproduces a real llama3.2 (Ollama) response that broke persistence:
    // Groq's strict json_schema mode guarantees a bare number, weaker local
    // models sometimes don't.
    expect(parseDuration('2.5 hours')).toBe(2.5);
    expect(parseDuration('2 h')).toBe(2);
  });

  it('returns undefined for a non-finite number', () => {
    expect(parseDuration(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(parseDuration(Number.NaN)).toBeUndefined();
  });

  it('returns undefined when no number can be extracted', () => {
    expect(parseDuration('unknown')).toBeUndefined();
    expect(parseDuration(null)).toBeUndefined();
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseDuration({})).toBeUndefined();
  });
});

describe('transformAiActivitiesToDto', () => {
  it('coerces a unit-wrapped duration string instead of persisting it raw', () => {
    const [dto] = transformAiActivitiesToDto([
      {
        activityId: '00000000-0000-4000-8000-000000000001',
        activityName: 'Parroquia San Juan Bosco',
        type: 'cultural',
        latitude: -26.82,
        longitude: -65.21,
        duration: '2.5 hours',
        dayNumber: 1,
      },
    ]);

    expect(dto.duration).toBe(2.5);
  });

  it('keeps a numeric duration unchanged', () => {
    const [dto] = transformAiActivitiesToDto([
      {
        activityId: '00000000-0000-4000-8000-000000000002',
        activityName: 'Museo',
        duration: 3,
        dayNumber: 1,
      },
    ]);

    expect(dto.duration).toBe(3);
  });
});
