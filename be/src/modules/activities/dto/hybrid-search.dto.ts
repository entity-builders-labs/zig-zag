import { IsNumber, Min, Max, IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class HybridSearchDto {
  @ApiProperty({
    description: 'Latitude coordinate',
    example: 40.7128,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber({}, { message: 'Latitude must be a number' })
  @Min(-90, { message: 'Latitude must be between -90 and 90' })
  @Max(90, { message: 'Latitude must be between -90 and 90' })
  latitude: number;

  @ApiProperty({
    description: 'Longitude coordinate',
    example: -74.006,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber({}, { message: 'Longitude must be a number' })
  @Min(-180, { message: 'Longitude must be between -180 and 180' })
  @Max(180, { message: 'Longitude must be between -180 and 180' })
  longitude: number;

  @ApiProperty({
    description: 'Search radius in meters',
    example: 5000,
    minimum: 0,
    maximum: 50000,
  })
  @IsNumber({}, { message: 'Radius must be a number' })
  @Min(0, { message: 'Radius must be at least 0' })
  @Max(50000, { message: 'Radius must be at most 50km (50000 meters)' })
  radius: number;

  @ApiProperty({
    description: 'Maximum number of results to return',
    required: false,
    example: 50,
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    const num = Number(value);
    if (isNaN(num)) throw new Error('Limit must be a valid number');
    return num;
  })
  @IsNumber({}, { message: 'Limit must be a valid number' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit must be at most 100' })
  limit?: number;

  @ApiProperty({
    description: 'Force refresh of cached data and trigger new crawling',
    required: false,
    example: false,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return Boolean(value);
  })
  @IsBoolean({ message: 'ForceRefresh must be a boolean value' })
  forceRefresh?: boolean;
}
