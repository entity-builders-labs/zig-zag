import { AccessibilityNeed } from '../interfaces/tour-generation.interface';
import { BadRequestException } from '@nestjs/common';
import { CreateTourFromWizardDto } from '../dto/create-tour-from-wizard.dto';
import { buildTourGenerationRequest } from './tour-generation-request.util';

function validDto(): CreateTourFromWizardDto {
  return {
    destination: {
      label: '  Córdoba, Argentina  ',
      latitude: -31.4201,
      longitude: -64.1888,
      radiusMeters: 8000,
      scaleHint: 'settlement' as any,
    },
    days: 2,
    budgetLevel: 'low' as any,
    groupType: 'couple' as any,
    intent: {
      interests: [' History ', 'history', ' Architecture '],
      intents: [' Day_Trip ', 'day_trip'],
      explorationStyle: 'balanced' as any,
      additionalPreferences: '  Street photography  ',
    },
    mobility: {
      allowedTransportationModes: ['walking' as any],
      maxWalkingDistancePerDayMeters: 5000,
      maxContinuousWalkingDistanceMeters: 1500,
      travelPace: 'moderate' as any,
      // Typed needs: only duplicates are removed; nothing is reinterpreted.
      accessibilityNeeds: [
        AccessibilityNeed.AVOID_STAIRS,
        AccessibilityNeed.AVOID_STAIRS,
      ],
    },
    dietaryRestrictions: [],
    startDates: [],
    includeExistingExperiences: true,
    skipImageGeneration: true,
    excludeTours: [],
    categories: [],
  };
}

describe('buildTourGenerationRequest', () => {
  it('normalizes the wizard input exactly once into the persisted contract', () => {
    const result = buildTourGenerationRequest(validDto());

    expect(result).toMatchObject({
      contractVersion: 1,
      destination: { label: 'Córdoba, Argentina' },
      intent: {
        interests: ['History', 'Architecture'],
        intents: ['Day_Trip'],
        additionalPreferences: 'Street photography',
      },
      mobility: { accessibilityNeeds: [AccessibilityNeed.AVOID_STAIRS] },
    });
  });

  it('rejects a continuous walking limit above the daily limit', () => {
    const dto = validDto();
    dto.mobility.maxContinuousWalkingDistanceMeters = 6000;

    expect(() => buildTourGenerationRequest(dto)).toThrow(BadRequestException);
  });
});
