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
  @ApiProperty({
    description:
      'Owning user id. Ignored on the public endpoint — the controller always overwrites it with the authenticated user.',
    required: false,
  })
  @IsString()
  @IsOptional()
  ownerId?: string;

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

  @ApiProperty({
    description: 'Original prompt that generated this tour',
    required: false,
  })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiProperty({ description: 'Search query if applicable', required: false })
  @IsString()
  @IsOptional()
  query?: string;

  @ApiProperty({
    description: 'Tour categories (e.g., walking, history, food)',
    required: false,
    type: [String],
    example: ['walking', 'history'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categories?: string[];

  @ApiProperty({ description: 'Flexible metadata (JSON)', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Prisma.JsonValue;
}
