import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BudgetLevel,
  DestinationScaleHint,
  ExplorationStyle,
  GroupType,
  TransportationMode,
  TravelPace,
} from '../interfaces/tour-generation.interface';

export const ADDITIONAL_PREFERENCES_MAX_LENGTH = 500;
const DESTINATION_LABEL_MAX_LENGTH = 300;
const INTENT_VALUE_MAX_LENGTH = 80;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class TourDestinationSelectionDto {
  @ApiProperty({
    description: 'Resolved provider display label, when one was selected',
    required: false,
    example: 'La Rioja, La Rioja Province, Argentina',
  })
  @Transform(trimString)
  @IsString()
  @MaxLength(DESTINATION_LABEL_MAX_LENGTH)
  @IsOptional()
  label?: string;

  @ApiProperty({ example: -29.413454 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -66.856458 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsLongitude()
  longitude: number;

  @ApiProperty({
    description: 'Bounded viewport-derived radius for point-scale recovery',
    required: false,
    minimum: 100,
    maximum: 100000,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(100)
  @Max(100000)
  @IsOptional()
  radiusMeters?: number;

  @ApiProperty({
    enum: DestinationScaleHint,
    description:
      'Provider-neutral hint preserving whether autocomplete selected an area or a specific point',
  })
  @IsEnum(DestinationScaleHint)
  scaleHint: DestinationScaleHint;
}

export class TourIntentDto {
  @ApiProperty({ type: [String], example: ['history', 'architecture'] })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(INTENT_VALUE_MAX_LENGTH, { each: true })
  interests: string[];

  @ApiProperty({ enum: ExplorationStyle })
  @IsEnum(ExplorationStyle)
  explorationStyle: ExplorationStyle;

  @ApiProperty({
    required: false,
    maxLength: ADDITIONAL_PREFERENCES_MAX_LENGTH,
    description:
      'Bounded supplemental intent; never trusted as entity identity or as an override of typed constraints',
  })
  @Transform(trimString)
  @IsString()
  @MaxLength(ADDITIONAL_PREFERENCES_MAX_LENGTH)
  @IsOptional()
  additionalPreferences?: string;
}

export class MobilityPreferencesDto {
  @ApiProperty({ enum: TransportationMode, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsEnum(TransportationMode, { each: true })
  allowedTransportationModes: TransportationMode[];

  @ApiProperty({ minimum: 500, maximum: 50000, example: 5000 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(500)
  @Max(50000)
  maxWalkingDistancePerDayMeters: number;

  @ApiProperty({ minimum: 100, maximum: 20000, example: 1500 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(100)
  @Max(20000)
  maxContinuousWalkingDistanceMeters: number;

  @ApiProperty({ enum: TravelPace })
  @IsEnum(TravelPace)
  travelPace: TravelPace;

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(INTENT_VALUE_MAX_LENGTH, { each: true })
  @IsOptional()
  accessibilityNeeds: string[] = [];
}

export class CreateTourFromWizardDto {
  @ApiProperty({ type: TourDestinationSelectionDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TourDestinationSelectionDto)
  destination: TourDestinationSelectionDto;

  @ApiProperty({ minimum: 1, maximum: 14, example: 3 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(14)
  days: number;

  @ApiProperty({ enum: BudgetLevel })
  @IsEnum(BudgetLevel)
  budgetLevel: BudgetLevel;

  @ApiProperty({ enum: GroupType })
  @IsEnum(GroupType)
  groupType: GroupType;

  @ApiProperty({ type: TourIntentDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TourIntentDto)
  intent: TourIntentDto;

  @ApiProperty({ type: MobilityPreferencesDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => MobilityPreferencesDto)
  mobility: MobilityPreferencesDto;

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(INTENT_VALUE_MAX_LENGTH, { each: true })
  @IsOptional()
  dietaryRestrictions: string[] = [];

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @ArrayMaxSize(2)
  @IsDateString({}, { each: true })
  @IsOptional()
  startDates: string[] = [];

  @ApiProperty({ default: true, required: false })
  @IsBoolean()
  @IsOptional()
  includeExistingActivities = true;

  @ApiProperty({ default: true, required: false })
  @IsBoolean()
  @IsOptional()
  skipImageGeneration = true;

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  excludeTours: string[] = [];

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(INTENT_VALUE_MAX_LENGTH, { each: true })
  @IsOptional()
  categories: string[] = [];
}
