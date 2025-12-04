import { ApiProperty } from '@nestjs/swagger';
import { ActivityMetadataDto } from './activity-metadata.dto';

/**
 * Response DTO for a single activity
 */
export class ActivityResponseDto {
  @ApiProperty({ description: 'Activity ID' })
  id: string;

  @ApiProperty({ description: 'Activity name' })
  name: string;

  @ApiProperty({ description: 'Activity description', required: false })
  description?: string;

  @ApiProperty({ description: 'Activity type', required: false })
  type?: string;

  @ApiProperty({ description: 'Activity metadata', required: false })
  metadata?: ActivityMetadataDto;

  @ApiProperty({ description: 'Latitude coordinate' })
  latitude: number;

  @ApiProperty({ description: 'Longitude coordinate' })
  longitude: number;

  @ApiProperty({
    description: 'Distance from reference point (km)',
    required: false,
  })
  distance?: number;

  @ApiProperty({ description: 'Weighted score for ranking', required: false })
  weightedScore?: number;
}

/**
 * Response DTO for activity search with crawling status
 */
export class ActivitySearchResponseDto {
  @ApiProperty({
    description: 'List of activities',
    type: [ActivityResponseDto],
  })
  activities: ActivityResponseDto[];

  @ApiProperty({ description: 'Whether results are from cache' })
  fromCache: boolean;

  @ApiProperty({ description: 'Whether background crawling was triggered' })
  crawlingTriggered: boolean;

  @ApiProperty({ description: 'Status message' })
  message: string;
}

/**
 * Response DTO for create many operation
 */
export class CreateManyResponseDto {
  @ApiProperty({ description: 'Number of activities created' })
  created: number;

  @ApiProperty({ description: 'Number of duplicate activities skipped' })
  duplicates: number;

  @ApiProperty({ description: 'Number of errors encountered' })
  errors: number;

  @ApiProperty({
    description: 'Created activities',
    type: [ActivityResponseDto],
  })
  activities: ActivityResponseDto[];
}
