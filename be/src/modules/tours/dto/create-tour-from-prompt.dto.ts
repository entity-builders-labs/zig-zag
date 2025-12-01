import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  Min,
  Max,
  IsDateString,
} from 'class-validator';

export enum BudgetLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum TransportationMode {
  WALKING = 'walking',
  DRIVING = 'driving',
  PUBLIC_TRANSPORT = 'public_transport',
  CYCLING = 'cycling',
}

export enum GroupType {
  SOLO = 'solo',
  COUPLE = 'couple',
  FAMILY = 'family',
  FRIENDS = 'friends',
}

export enum TravelPace {
  RELAXED = 'relaxed',
  MODERATE = 'moderate',
  FAST = 'fast',
}

export class CreateTourActivityFromPromptDto {
  @ApiProperty({
    description: 'Activity ID if it exists in database',
    required: false,
  })
  @IsString()
  @IsOptional()
  activityId?: string;

  @ApiProperty({ description: 'Activity name', required: false })
  @IsString()
  @IsOptional()
  activityName?: string;

  @ApiProperty({ description: 'Activity type', required: false })
  @IsString()
  @IsOptional()
  activityType?: string;

  @ApiProperty({ description: 'Latitude', required: false })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiProperty({ description: 'Longitude', required: false })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiProperty({ description: 'Day number in the tour', required: false })
  @IsNumber()
  @IsOptional()
  dayNumber?: number;

  @ApiProperty({
    description: 'Start time (string or ISO date)',
    required: false,
  })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiProperty({ description: 'Duration in minutes', required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({
    description: 'Travel time to next activity (minutes)',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  travelTimeToNext?: number;

  @ApiProperty({
    description: 'Distance to next activity (km)',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  distanceToNext?: number;

  @ApiProperty({ description: 'Notes about the activity', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  // Allow additional properties from AI response
  [key: string]: any;
}

export class CreateTourFromPromptDto {
  @ApiProperty({
    description:
      'Natural language prompt to generate the tour. If not provided, will be auto-generated from other fields',
    required: false,
    example: 'Plan a 3-day tour in Cancun with beach and cultural activities',
  })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiProperty({
    description:
      'Tour name/title. Used to auto-generate prompt if prompt is not provided',
    required: false,
    example: 'Cancun Beach & Culture Adventure',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Tour description. Used to enrich the auto-generated prompt',
    required: false,
    example: 'A perfect mix of beach relaxation and cultural exploration',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Destination name or address for the tour',
    required: false,
    example: 'Cancun, Mexico',
  })
  @IsString()
  @IsOptional()
  destination?: string;

  @ApiProperty({
    description: 'Destination latitude (coordinates of the destination)',
    required: false,
    example: 21.1619,
  })
  @IsNumber()
  @IsOptional()
  destinationLatitude?: number;

  @ApiProperty({
    description: 'Destination longitude (coordinates of the destination)',
    required: false,
    example: -86.8515,
  })
  @IsNumber()
  @IsOptional()
  destinationLongitude?: number;

  @ApiProperty({
    description: 'Latitude for location-based tour generation',
    required: false,
    minimum: -90,
    maximum: 90,
    default: -34.5209462,
    example: -34.5209462,
  })
  @IsNumber()
  @IsOptional()
  latitude?: number = -34.5209462;

  @ApiProperty({
    description: 'Longitude for location-based tour generation',
    required: false,
    minimum: -180,
    maximum: 180,
    default: -58.4972602,
    example: -58.4972602,
  })
  @IsNumber()
  @IsOptional()
  longitude?: number = -58.4972602;

  @ApiProperty({
    description: 'Search radius in meters for finding nearby activities',
    required: false,
    default: 50000,
    example: 50000,
  })
  @IsNumber()
  @IsOptional()
  radius?: number;

  @ApiProperty({
    description:
      'Whether to include existing activities from database in the tour',
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  includeExistingActivities?: boolean;

  @ApiProperty({
    description: 'Number of days for the tour',
    required: false,
    example: 3,
    minimum: 1,
    maximum: 14,
  })
  @IsNumber()
  @Min(1)
  @Max(14)
  @IsOptional()
  days?: number;

  @ApiProperty({
    description: 'Total distance in kilometers for the tour',
    required: false,
    example: 50,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalDistance?: number;

  @ApiProperty({
    description: 'Maximum price/budget for the tour',
    required: false,
    example: 500,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @ApiProperty({
    description: 'Estimated budget for the tour',
    required: false,
    example: 300,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedBudget?: number;

  @ApiProperty({
    description: 'Maximum group size for the tour',
    required: false,
    example: 10,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  maxGroupSize?: number;

  @ApiProperty({
    description: 'Recommended group size for the tour',
    required: false,
    example: 4,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  recommendedGroupSize?: number;

  @ApiProperty({
    description: 'Preferred start dates for the tour (ISO date strings)',
    required: false,
    type: [String],
    example: ['2024-06-01T00:00:00Z'],
  })
  @IsArray()
  @IsDateString({}, { each: true })
  @IsOptional()
  startDates?: string[];

  @ApiProperty({
    description: 'Activity categories or types to include in the tour',
    required: false,
    type: [String],
    example: ['beach', 'museum', 'restaurant', 'hiking'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categories?: string[];

  @ApiProperty({
    description: 'Budget level for the tour',
    enum: BudgetLevel,
    required: false,
    example: BudgetLevel.MEDIUM,
  })
  @IsEnum(BudgetLevel)
  @IsOptional()
  budgetLevel?: BudgetLevel;

  @ApiProperty({
    description: 'Specific interests or tags to focus on',
    type: [String],
    required: false,
    example: ['history', 'food', 'beach'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  interests?: string[];

  @ApiProperty({
    description: 'Preferred mode of transportation',
    enum: TransportationMode,
    required: false,
    default: TransportationMode.WALKING,
  })
  @IsEnum(TransportationMode)
  @IsOptional()
  transportationMode?: TransportationMode;

  @ApiProperty({
    description: 'Type of group traveling',
    enum: GroupType,
    required: false,
    example: GroupType.COUPLE,
  })
  @IsEnum(GroupType)
  @IsOptional()
  groupType?: GroupType;

  @ApiProperty({
    description: 'Travel pace preference',
    enum: TravelPace,
    required: false,
    example: TravelPace.MODERATE,
  })
  @IsEnum(TravelPace)
  @IsOptional()
  travelPace?: TravelPace;

  @ApiProperty({
    description: 'Dietary restrictions or preferences',
    type: [String],
    required: false,
    example: ['vegetarian', 'gluten-free'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dietaryRestrictions?: string[];

  @ApiProperty({
    description: 'Skip AI image generation for tour cover and activities',
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  skipImageGeneration?: boolean = true;

  @ApiProperty({
    description:
      'Skip activities generation - create tour only, generate activities later',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  skipActivities?: boolean = false;

  @ApiProperty({
    description: 'List of Tour IDs to exclude/avoid similarity with',
    required: false,
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  excludeTours?: string[];
}
