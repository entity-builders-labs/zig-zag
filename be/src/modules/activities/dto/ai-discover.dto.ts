// @ts-nocheck
import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { appConfig } from '../../../core/config/app.config';

export class AiDiscoverDto {
  @ApiProperty({
    description: 'Latitude',
    example: appConfig().defaults.location.latitude,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({
    description: 'Longitude',
    example: appConfig().defaults.location.longitude,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({
    description: 'Radius in meters',
    required: false,
    default: 5000,
    maximum: 50000,
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 5000 : Number(value)))
  @IsNumber()
  @Min(0)
  @Max(50000)
  radius?: number = 5000;

  @ApiProperty({
    description: 'Max candidates to create',
    required: false,
    default: 20,
    maximum: 50,
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 20 : Number(value)))
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiProperty({
    description: 'Canonical categories to target',
    required: false,
    example: ['food', 'cultural'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  types?: string[];

  @ApiProperty({
    description: 'Optional guiding query for the LLM',
    required: false,
  })
  @IsOptional()
  @IsString()
  seedQuery?: string;
}
