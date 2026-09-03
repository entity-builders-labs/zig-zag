import { BadRequestException } from '@nestjs/common';
import { CreateTourFromWizardDto } from '../dto/create-tour-from-wizard.dto';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';

function normalizeValues(values: string[] | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const trimmed = value.trim();
    const identity = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(identity)) continue;
    seen.add(identity);
    normalized.push(trimmed);
  }

  return normalized;
}

export function buildTourGenerationRequest(
  dto: CreateTourFromWizardDto,
): TourGenerationRequest {
  if (
    dto.mobility.maxContinuousWalkingDistanceMeters >
    dto.mobility.maxWalkingDistancePerDayMeters
  ) {
    throw new BadRequestException(
      'maxContinuousWalkingDistanceMeters cannot exceed maxWalkingDistancePerDayMeters',
    );
  }

  const additionalPreferences = dto.intent.additionalPreferences?.trim();
  const destinationLabel = dto.destination.label?.trim();

  return {
    contractVersion: 1,
    destination: {
      label: destinationLabel || undefined,
      latitude: dto.destination.latitude,
      longitude: dto.destination.longitude,
      radiusMeters: dto.destination.radiusMeters,
      scaleHint: dto.destination.scaleHint,
    },
    days: dto.days,
    budgetLevel: dto.budgetLevel,
    groupType: dto.groupType,
    intent: {
      interests: normalizeValues(dto.intent.interests),
      intents: normalizeValues(dto.intent.intents),
      explorationStyle: dto.intent.explorationStyle,
      additionalPreferences: additionalPreferences || undefined,
    },
    mobility: {
      allowedTransportationModes: [
        ...new Set(dto.mobility.allowedTransportationModes),
      ],
      maxWalkingDistancePerDayMeters:
        dto.mobility.maxWalkingDistancePerDayMeters,
      maxContinuousWalkingDistanceMeters:
        dto.mobility.maxContinuousWalkingDistanceMeters,
      travelPace: dto.mobility.travelPace,
      accessibilityNeeds: normalizeValues(dto.mobility.accessibilityNeeds),
    },
    dietaryRestrictions: normalizeValues(dto.dietaryRestrictions),
    startDates: [...(dto.startDates ?? [])],
    includeExistingExperiences: dto.includeExistingExperiences !== false,
    skipImageGeneration: dto.skipImageGeneration !== false,
    excludeTours: normalizeValues(dto.excludeTours),
    categories: normalizeValues(dto.categories),
  };
}
