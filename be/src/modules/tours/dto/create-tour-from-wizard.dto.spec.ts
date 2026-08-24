import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ADDITIONAL_PREFERENCES_MAX_LENGTH,
  CreateTourFromWizardDto,
} from './create-tour-from-wizard.dto';

const validPayload = () => ({
  destination: {
    label: 'La Rioja, Argentina',
    latitude: -29.413454,
    longitude: -66.856458,
    radiusMeters: 9000,
    scaleHint: 'settlement',
  },
  days: 2,
  budgetLevel: 'medium',
  groupType: 'family',
  intent: {
    interests: ['history', 'architecture'],
    experienceFormats: ['point_visits', 'neighborhood_walks'],
    explorationStyle: 'balanced',
    additionalPreferences: '  Prefer photography stops  ',
  },
  mobility: {
    allowedTransportationModes: ['walking', 'public_transport'],
    maxWalkingDistancePerDayMeters: 5000,
    maxContinuousWalkingDistanceMeters: 1500,
    travelPace: 'moderate',
    accessibilityNeeds: [] as string[],
  },
});

async function errorsFor(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreateTourFromWizardDto, payload));
}

describe('CreateTourFromWizardDto', () => {
  it('accepts the complete canonical contract and trims supplemental intent', async () => {
    const instance = plainToInstance(CreateTourFromWizardDto, validPayload());

    await expect(validate(instance)).resolves.toEqual([]);
    expect(instance.intent.additionalPreferences).toBe(
      'Prefer photography stops',
    );
  });

  it('rejects an empty transportation mode list', async () => {
    const payload = validPayload();
    payload.mobility.allowedTransportationModes = [];

    expect(await errorsFor(payload)).not.toEqual([]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects invalid daily walking distance %s',
    async (distance) => {
      const payload = validPayload();
      payload.mobility.maxWalkingDistancePerDayMeters = distance;

      expect(await errorsFor(payload)).not.toEqual([]);
    },
  );

  it('rejects an unknown experience format', async () => {
    const payload = validPayload();
    payload.intent.experienceFormats = ['point_visits', 'invented_walk'];

    expect(await errorsFor(payload)).not.toEqual([]);
  });

  it('rejects over-limit additional preferences', async () => {
    const payload = validPayload();
    payload.intent.additionalPreferences = 'x'.repeat(
      ADDITIONAL_PREFERENCES_MAX_LENGTH + 1,
    );

    expect(await errorsFor(payload)).not.toEqual([]);
  });
});
