import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
  IsObject,
} from 'class-validator';
import { Prisma } from '@prisma/client';

export class CreateTourDto {
  @ApiProperty({ description: 'Tour name', required: true })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Tour description', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Tour price', required: false })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiProperty({ description: 'Tour duration in hours', required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({ description: 'Maximum group size', required: false })
  @IsNumber()
  @IsOptional()
  maxGroupSize?: number;

  @ApiProperty({ description: 'Start dates for the tour', required: false })
  @IsArray()
  @IsOptional()
  @IsDateString({}, { each: true })
  startDates?: Date[];

  @ApiProperty({ description: 'Total days of the tour', required: false })
  @IsNumber()
  @IsOptional()
  totalDays?: number;

  @ApiProperty({ description: 'Total distance in km', required: false })
  @IsNumber()
  @IsOptional()
  totalDistance?: number;

  @ApiProperty({ description: 'Estimated budget', required: false })
  @IsNumber()
  @IsOptional()
  estimatedBudget?: number;

  @ApiProperty({ description: 'Recommended group size', required: false })
  @IsNumber()
  @IsOptional()
  recommendedGroupSize?: number;

  @ApiProperty({ description: 'Original prompt that generated this tour', required: false })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiProperty({ description: 'Search query if applicable', required: false })
  @IsString()
  @IsOptional()
  query?: string;

  @ApiProperty({ description: 'Flexible metadata (JSON)', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Prisma.JsonValue;

  @ApiProperty({ description: 'Tour activities', required: false })
  @IsArray()
  @IsOptional()
  activities?: CreateTourActivityDto[];
}

export class CreateTourActivityDto {
  @ApiProperty({ description: 'Activity ID (if activity exists in DB)', required: false })
  @IsString()
  @IsOptional()
  activityId?: string;

  @ApiProperty({ description: 'Activity name (if creating inline)', required: false })
  @IsString()
  @IsOptional()
  activityName?: string;

  @ApiProperty({ description: 'Activity type', required: false })
  @IsString()
  @IsOptional()
  activityType?: string;

  @ApiProperty({ description: 'Activity latitude', required: false })
  @IsNumber()
  @IsOptional()
  activityLatitude?: number;

  @ApiProperty({ description: 'Activity longitude', required: false })
  @IsNumber()
  @IsOptional()
  activityLongitude?: number;

  @ApiProperty({ description: 'Full activity data as JSON (if creating inline)', required: false })
  @IsObject()
  @IsOptional()
  activityData?: Prisma.JsonValue;

  @ApiProperty({ description: 'Duration for this activity in tour context (minutes)', required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({ description: 'Start time for this activity', required: false })
  @IsString()
  @IsOptional()
  startTime?: string | Date;

  @ApiProperty({ description: 'Detailed notes about the activity', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Day number in the tour', required: false })
  @IsNumber()
  @IsOptional()
  dayNumber?: number;

  @ApiProperty({ description: 'Travel time to next activity (minutes)', required: false })
  @IsNumber()
  @IsOptional()
  travelTimeToNext?: number;

  @ApiProperty({ description: 'Distance to next activity (km)', required: false })
  @IsNumber()
  @IsOptional()
  distanceToNext?: number;

  @ApiProperty({ description: 'Order in the tour sequence', required: false })
  @IsNumber()
  @IsOptional()
  order?: number;
}
