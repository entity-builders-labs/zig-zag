import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  IsArray,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { appConfig } from '../../../core/config/app.config';

export class FindAllActivitiesDto {
  @ApiProperty({
    description: 'Latitude coordinate',
    example: appConfig().defaults.location.latitude,
    minimum: -90,
    maximum: 90,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return appConfig().defaults.location.latitude;
    const num = Number(value);
    if (isNaN(num)) throw new Error('Latitude must be a valid number');
    return num;
  })
  @IsNumber({}, { message: 'Latitude must be a number' })
  @Min(-90, { message: 'Latitude must be between -90 and 90' })
  @Max(90, { message: 'Latitude must be between -90 and 90' })
  latitude?: number;

  @ApiProperty({
    description: 'Longitude coordinate',
    example: appConfig().defaults.location.longitude,
    minimum: -180,
    maximum: 180,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return appConfig().defaults.location.longitude;
    const num = Number(value);
    if (isNaN(num)) throw new Error('Longitude must be a valid number');
    return num;
  })
  @IsNumber({}, { message: 'Longitude must be a number' })
  @Min(-180, { message: 'Longitude must be between -180 and 180' })
  @Max(180, { message: 'Longitude must be between -180 and 180' })
  longitude?: number;

  @ApiProperty({
    description: 'Search radius in meters',
    example: 50000,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return 50000;
    const num = Number(value);
    if (isNaN(num)) throw new Error('Radius must be a valid number');
    return num;
  })
  @IsNumber({}, { message: 'Radius must be a number' })
  @Min(0, { message: 'Radius must be at least 0' })
  radius?: number;

  @ApiProperty({
    description: 'Maximum number of results to return',
    example: 100,
    minimum: 1,
    maximum: 1000,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return 100;
    const num = Number(value);
    if (isNaN(num)) throw new Error('Limit must be a valid number');
    return num;
  })
  @IsNumber({}, { message: 'Limit must be a number' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(1000, { message: 'Limit must be at most 1000' })
  limit?: number;

  @ApiProperty({
    description: 'Filter by activity types',
    example: ['cultural', 'outdoor'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Types must be an array' })
  @IsString({ each: true, message: 'Each type must be a string' })
  types?: string[];
}
