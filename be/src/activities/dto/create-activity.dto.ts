import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsObject,
  IsEnum,
} from 'class-validator';

import { Prisma } from '@prisma/client';

// Using the Prisma generated enum
import { Difficulty } from '@prisma/client';

export class CreateActivityDto {
  @ApiProperty({ description: 'ID of the source of this activity' })
  @IsString()
  @IsNotEmpty()
  sourceId: string;

  @ApiProperty({
    description:
      'External ID from the source system (unique identifier in the source)',
  })
  @IsString()
  @IsNotEmpty()
  externalId: string;

  @ApiProperty({ description: 'The name of the activity' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The description of the activity',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description:
      'The type of activity (e.g., "Hiking", "Swimming", "Climbing")',
    example: 'Hiking',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsEnum(Difficulty)
  @IsOptional()
  difficulty?: Difficulty;

  @ApiProperty({ description: 'The location of the activity' })
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Latitude of the activity location',
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({
    description: 'Longitude of the activity location',
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({
    description: 'Structured location information',
    example: {
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      country: 'USA',
      postalCode: '10001',
    },
  })
  @IsObject()
  @IsOptional()
  location?: Prisma.JsonValue;

  @ApiProperty({
    description: 'Google Maps Place ID',
    required: false,
  })
  @IsString()
  @IsOptional()
  placeId?: string;

  @ApiProperty({
    description: 'Google Places rating (0-5)',
    required: false,
    minimum: 0,
    maximum: 5,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(5)
  rating?: number;

  @ApiProperty({
    description: 'Number of Google Places ratings',
    required: false,
    minimum: 0,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  ratingCount?: number;

  @ApiProperty({
    description: 'Formatted address from Google Places',
    required: false,
  })
  @IsString()
  @IsOptional()
  formattedAddress?: string;

  @ApiProperty({
    description: 'Phone number from Google Places',
    required: false,
  })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({
    description: 'Website URL from Google Places',
    required: false,
  })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiProperty({
    description: 'Business status from Google Places',
    required: false,
    example: 'OPERATIONAL',
  })
  @IsString()
  @IsOptional()
  businessStatus?: string;

  @ApiProperty({
    description: 'Price level from Google Places (1-5)',
    required: false,
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(5)
  priceLevel?: number;

  @ApiProperty({
    description: 'Photo references from Google Places',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsString({ each: true })
  photos?: string[];

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  duration: number;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  maxGroupSize: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  knownActivityTypeName: string;

  @ApiProperty({ description: 'ID of the activity' })
  @IsString()
  @IsOptional()
  id?: string;
}
