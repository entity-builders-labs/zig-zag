import { IsNumber, Min, Max, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

import { appConfig } from '../../../core/config/app.config';

export class FindNearbyDto {
  @ApiProperty({
    description: 'Latitude coordinate',
    example: appConfig().defaults.location.latitude,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber({}, { message: 'Latitude must be a number' })
  latitude: number;

  @ApiProperty({
    description: 'Longitude coordinate',
    example: appConfig().defaults.location.longitude,
  })
  @IsNumber({}, { message: 'Longitude must be a number' })
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({
    description: 'Search radius in kilometers',
    example: 5,
    minimum: 0,
  })
  @IsNumber({}, { message: 'Radius must be a number' })
  @Min(0)
  radius: number;

  @ApiProperty({
    description: 'Maximum results to return',
    required: false,
    example: '10',
    type: Number,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    const num = Number(value);
    if (isNaN(num)) throw new Error('Must be a valid number');
    return num;
  })
  @IsNumber({}, { message: 'Limit must be a valid number between 1 and 100' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit must be at most 100' })
  limit?: number;
}
