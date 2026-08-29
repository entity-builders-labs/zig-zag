import { Injectable } from '@nestjs/common';
import { ActivityKind, Prisma } from '@prisma/client';

export const SEMANTIC_ACTIVITY_DOCUMENT_VERSION = 1;

export type SemanticActivityRecord = Prisma.ActivityGetPayload<{
  include: {
    family: {
      include: {
        areaActivity: {
          select: { name: true };
        };
      };
    };
    compositeWaypoints: {
      include: {
        waypointActivity: {
          select: {
            name: true;
            kind: true;
            type: true;
            knownActivityTypeName: true;
          };
        };
      };
    };
  };
}>;

function compact(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(compact).filter((v): v is string => !!v))];
}

@Injectable()
export class SemanticActivityDocumentBuilder {
  readonly documentVersion = SEMANTIC_ACTIVITY_DOCUMENT_VERSION;

  build(activity: SemanticActivityRecord): string {
    const classifications = unique([
      activity.knownActivityTypeName,
      activity.type,
      activity.variantTheme?.toLowerCase().replace(/_/g, ' '),
    ]);
    const areaName = compact(activity.family?.areaActivity?.name);
    const waypoints = activity.compositeWaypoints.map(
      ({ waypointActivity }) => {
        const waypointType =
          compact(waypointActivity.knownActivityTypeName) ||
          compact(waypointActivity.type) ||
          waypointActivity.kind.toLowerCase();
        return `${compact(waypointActivity.name) || 'Unnamed waypoint'} (${waypointType})`;
      },
    );

    const lines = [
      `Name: ${compact(activity.name) || 'Unnamed activity'}`,
      `Kind: ${activity.kind}`,
      compact(activity.description)
        ? `Description: ${compact(activity.description)}`
        : undefined,
      classifications.length > 0
        ? `Themes and types: ${classifications.join(', ')}`
        : undefined,
      areaName ? `Area: ${areaName}` : undefined,
      Number.isFinite(activity.duration)
        ? `Suggested duration: ${activity.duration} hours`
        : undefined,
      activity.kind !== ActivityKind.POI && waypoints.length > 0
        ? `Verified waypoints: ${waypoints.join('; ')}`
        : undefined,
    ];

    return lines.filter((line): line is string => !!line).join('\n');
  }
}
