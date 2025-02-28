import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class ActivityMetadataDto {
  @ApiProperty({
    description: 'Enhanced description of the activity',
    example:
      'A breathtaking hike through pristine mountain landscapes with panoramic views of the valley below...',
  })
  @IsString()
  @IsOptional()
  enhancedDescription?: string;

  @ApiProperty({
    description: 'Tags or keywords related to the activity',
    example: ['outdoor', 'nature', 'hiking', 'family-friendly', 'scenic'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiProperty({
    description: 'Target audience for the activity',
    example:
      'Ideal for families with children over 10, nature enthusiasts, and photography lovers',
  })
  @IsString()
  @IsOptional()
  targetAudience?: string;

  @ApiProperty({
    description: 'Best time to visit or do the activity',
    example:
      'Spring and early summer (April-June) when wildflowers are in bloom. Early morning offers the best lighting for photos.',
  })
  @IsString()
  @IsOptional()
  bestTimeToVisit?: string;

  @ApiProperty({
    description: 'Information about the activity accessibility',
    example:
      'The trail is not wheelchair accessible. Moderate fitness level required. Some sections have steep inclines.',
  })
  @IsString()
  @IsOptional()
  accessibilityInfo?: string;

  @ApiProperty({
    description: 'Recommended equipment or items to bring',
    example:
      'Hiking boots, water bottle, sunscreen, hat, camera, and light snacks',
  })
  @IsString()
  @IsOptional()
  recommendedEquipment?: string;

  @ApiProperty({
    description:
      'Cultural or historical significance of the activity or location',
    example:
      'This trail follows ancient trading routes used by indigenous peoples for centuries...',
  })
  @IsString()
  @IsOptional()
  culturalRelevance?: string;

  @ApiProperty({
    description: 'Sustainability rating of the activity (1-5)',
    example: 4,
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(5)
  sustainabilityRating?: number;

  @ApiProperty({
    description: 'Local tips and insider information about the activity',
    example:
      'The hidden viewpoint at the 2km mark offers the best photo opportunities. Local guides can be hired at the visitor center.',
  })
  @IsString()
  @IsOptional()
  localTips?: string;

  @ApiProperty({
    description: 'Weather considerations for the activity',
    example:
      'Trail can be slippery after rain. Check weather forecast before heading out. Avoid during thunderstorms.',
  })
  @IsString()
  @IsOptional()
  weatherConsiderations?: string;
}
