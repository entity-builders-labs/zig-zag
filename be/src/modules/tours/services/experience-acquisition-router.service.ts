import { Injectable } from '@nestjs/common';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';
import { StructuredPlaceCoverage } from '../constants/acquisition-source-routing';

export const ACQUISITION_ROUTING_POLICY_VERSION = 'gap-source-routing-v2';

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
  /** STRUCTURED_POI only: destination-wide base discovery (capacity gap). */
  baseDiscovery?: boolean;
  /** STRUCTURED_POI only: typed place-class coverage requested by facet gaps. */
  coverage?: StructuredPlaceCoverage[];
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
    /** Whether a destination-wide capacity gap asks for base discovery. */
    baseDiscovery?: boolean;
    /** Typed coverage from facet gaps (canonical capability table). */
    coverage?: readonly StructuredPlaceCoverage[];
  }): AcquisitionRoute {
    const baseDiscovery = input.baseDiscovery ?? true;
    const coverage = [...new Set(input.coverage ?? [])].sort();
    const strategies: AcquisitionStrategy[] =
      input.gapType === 'PLACE_CANDIDATES' &&
      Number.isFinite(input.destination.latitude) &&
      Number.isFinite(input.destination.longitude) &&
      Number.isFinite(input.destination.radiusMeters) &&
      (input.destination.radiusMeters ?? 0) > 0 &&
      (baseDiscovery || coverage.length > 0)
        ? [
            ...(input.availability.openstreetmap
              ? [
                  {
                    sourceClass: 'STRUCTURED_POI' as const,
                    provider: 'openstreetmap' as const,
                    baseDiscovery,
                    coverage,
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
