import { Injectable } from '@nestjs/common';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';

export const ACQUISITION_ROUTING_POLICY_VERSION = 'gap-source-routing-v1';

export type AcquisitionGapType =
  | 'AREA_CANDIDATES'
  | 'PLACE_CANDIDATES'
  | 'ROUTE_CANDIDATES'
  | 'PLACE_RELEVANCE'
  | 'AREA_RELEVANCE'
  | 'VISIT_DURATION';

export type AcquisitionSourceClass =
  | 'GEOGRAPHIC_STRUCTURE'
  | 'STRUCTURED_POI'
  | 'STRUCTURED_ENTITY_FACTS'
  | 'ROUTE_GEOMETRY'
  | 'RESEARCH_MEMORY'
  | 'WEB_EVIDENCE';

export interface AcquisitionStrategy {
  sourceClass: AcquisitionSourceClass;
  provider: 'openstreetmap' | 'wikidata' | 'web_evidence';
}

export interface AcquisitionRoute {
  policyVersion: string;
  gapType: AcquisitionGapType;
  strategies: AcquisitionStrategy[];
}

/** Versioned gap-type router; it never selects sources from semantic prose. */
@Injectable()
export class ExperienceAcquisitionRouter {
  route(input: {
    gapType: AcquisitionGapType;
    destination: ExperienceDiscoveryScope;
    availability: {
      openstreetmap: boolean;
      wikidata: boolean;
    };
  }): AcquisitionRoute {
    const strategies: AcquisitionStrategy[] =
      input.gapType === 'PLACE_CANDIDATES' &&
      Number.isFinite(input.destination.latitude) &&
      Number.isFinite(input.destination.longitude) &&
      Number.isFinite(input.destination.radiusMeters) &&
      (input.destination.radiusMeters ?? 0) > 0
        ? [
            ...(input.availability.openstreetmap
              ? [
                  {
                    sourceClass: 'STRUCTURED_POI' as const,
                    provider: 'openstreetmap' as const,
                  },
                ]
              : []),
            ...(input.availability.wikidata
              ? [
                  {
                    sourceClass: 'STRUCTURED_ENTITY_FACTS' as const,
                    provider: 'wikidata' as const,
                  },
                ]
              : []),
          ]
        : [];
    return {
      policyVersion: ACQUISITION_ROUTING_POLICY_VERSION,
      gapType: input.gapType,
      strategies,
    };
  }
}
