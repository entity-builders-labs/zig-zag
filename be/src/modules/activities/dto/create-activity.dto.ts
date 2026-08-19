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
  IsBoolean,
} from 'class-validator';

import { Prisma, Difficulty, ActivityKind, VariantTheme } from '@prisma/client';

// Using the Prisma generated enum
// import { Difficulty } from '@prisma/client';

export class CreateActivityDto {
  @ApiProperty({ description: 'The name of the activity', required: true })
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
    required: false,
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiProperty({ description: 'Difficulty level', required: false })
  @IsEnum(Difficulty)
  @IsOptional()
  difficulty?: any;

  @ApiProperty({
    description: 'Duration in minutes/hours',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  duration?: number;

  @ApiProperty({
    description: 'Price in local currency',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  @ApiProperty({
    description: 'Maximum group size',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  maxGroupSize?: number;

  @ApiProperty({
    description: 'Latitude of the activity location',
    minimum: -90,
    maximum: 90,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiProperty({
    description: 'Longitude of the activity location',
    minimum: -180,
    maximum: 180,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiProperty({
    description: 'Simple address string',
    required: false,
  })
  @IsString()
  @IsOptional()
  address?: string;

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
  location?: any;

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

  @ApiProperty({
    description:
      'Opening hours, one human-readable line per weekday (e.g. { weekdayText: ["Monday: 9:00 AM – 6:00 PM", ...] })',
    required: false,
  })
  @IsObject()
  @IsOptional()
  openingHours?: Prisma.JsonValue;

  @ApiProperty({
    description: 'ID of the source of this activity (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  sourceId?: string;

  @ApiProperty({
    description:
      'External ID from the source system (optional for AI-generated activities)',
    required: false,
  })
  @IsString()
  @IsOptional()
  externalId?: string;

  @ApiProperty({
    description: 'Known activity type name (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  knownActivityTypeName?: string;

  @ApiProperty({
    description: 'Flexible metadata (JSON) for storing AI-generated data',
    required: false,
  })
  @IsObject()
  @IsOptional()
  metadata?: Prisma.JsonValue;

  @ApiProperty({
    description: 'ID of the activity (for updates)',
    required: false,
  })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({
    description:
      'Structural shape of the activity: a single point (POI, default), a multi-stop composite (NEIGHBORHOOD_WALK/EXPERIENCE), a themed path (ROUTE), or a geographic container (AREA). Orthogonal to `type`, which classifies subject matter (museum, restaurant, ...).',
    enum: ActivityKind,
    required: false,
  })
  @IsEnum(ActivityKind)
  @IsOptional()
  kind?: ActivityKind;

  @ApiProperty({
    description:
      'Theme of a variant (kind NEIGHBORHOOD_WALK/ROUTE/EXPERIENCE only). Null for POI/AREA.',
    enum: VariantTheme,
    required: false,
  })
  @IsEnum(VariantTheme)
  @IsOptional()
  variantTheme?: VariantTheme;

  @ApiProperty({
    description:
      'Real GeoJSON geometry sourced from OSM: Polygon/MultiPolygon when kind=AREA, LineString when kind=ROUTE and the trace itself is the content. Never authored by an LLM.',
    required: false,
  })
  @IsObject()
  @IsOptional()
  boundary?: Prisma.JsonValue;

  @ApiProperty({
    description:
      'True for variants pre-generated and validated offline, as opposed to ones assembled ad hoc during a live tour generation.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isCurated?: boolean;

  @ApiProperty({
    description:
      'True when this activity has been retired from circulation without being physically deleted. Excluded from discovery surfaces by default.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isArchived?: boolean;

  @ApiProperty({
    description:
      'ID of the ActivityFamily this variant belongs to. Only meaningful for variants (kind != POI/AREA).',
    required: false,
  })
  @IsString()
  @IsOptional()
  familyId?: string;
}
