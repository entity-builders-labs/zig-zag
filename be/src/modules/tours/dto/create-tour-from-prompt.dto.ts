import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional } from 'class-validator';

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
    description: 'Natural language prompt to generate the tour',
    example: 'Plan a 3-day tour in Cancun with beach and cultural activities',
  })
  @IsString()
  prompt: string;

  @ApiProperty({
    description: 'Latitude for location-based tour generation',
    required: false,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiProperty({
    description: 'Longitude for location-based tour generation',
    required: false,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  @IsOptional()
  longitude?: number;

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
  @IsOptional()
  includeExistingActivities?: boolean;
}
