import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class UpdateTourActivityWaypointsDto {
  @ApiProperty({
    description:
      "The subset (and order) of the variant's own waypoints to show for this tour instance — e.g. excluding a stop for a family with kids. Every id must belong to the variant's current ActivityWaypoint set; an invalid/too-small subset is ignored rather than applied.",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  selectedWaypointActivityIds: string[];
}
