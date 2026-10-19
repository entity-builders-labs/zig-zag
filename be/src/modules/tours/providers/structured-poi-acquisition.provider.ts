import { Injectable } from '@nestjs/common';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { OSM_ADMISSION_DISCOVERY_SELECTORS } from '@integrations/osm/utils/osm-admission-adapter';
import { OverpassSelector } from '@integrations/osm/interfaces/overpass.interface';
import {
  AcquisitionProviderResult,
  SourceObservation,
} from '../interfaces/experience-acquisition.interface';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  OsmAdmissionFacts,
  OsmVisitDurationEvidence,
  OsmVisitUnitFacts,
  osmTagsToAdmissionFacts,
  osmTagsToOpeningHoursEvidence,
  osmTagsToVisitDurationEvidence,
  osmTagsToVisitUnitFacts,
} from '@integrations/osm/utils/osm-admission-adapter';

export interface StructuredPoiCandidate extends SourceObservation {
  osmType: OsmCandidate['osmType'];
  osmId: number;
  tags: Record<string, string>;
  osmGeometry: OsmCandidate['geometry'];
  memberIds?: string[];
  identityMemberIds?: string[];
  admissionFacts: OsmAdmissionFacts;
  openingHoursEvidence?: string;
  visitUnitFacts: OsmVisitUnitFacts;
  visitDurationEvidence?: OsmVisitDurationEvidence;
}

function discoverySelectors(): OverpassSelector[] {
  return OSM_ADMISSION_DISCOVERY_SELECTORS.flatMap((selector) => {
    if (selector.includeValues?.length) {
      return selector.includeValues.map((value) => ({
        key: selector.key,
        value,
      }));
    }
    return [{ key: selector.key }];
  });
}

@Injectable()
export class StructuredPoiAcquisitionProvider {
  constructor(private readonly osmPlaces: OsmPlacesService) {}

  async acquire(
    destination: ExperienceDiscoveryScope,
    options: { radiusMeters: number },
  ): Promise<AcquisitionProviderResult<StructuredPoiCandidate>> {
    const { latitude, longitude } = destination;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(options.radiusMeters) ||
      options.radiusMeters <= 0
    ) {
      return {
        status: 'failed',
        value: [],
        failureReason: 'STRUCTURED_POI requires a resolved destination window',
      };
    }

    const lookup = await this.osmPlaces.lookupFeaturesNear(
      latitude as number,
      longitude as number,
      options.radiusMeters,
      discoverySelectors(),
    );
    if (lookup.status === 'failed') {
      return {
        status: 'failed',
        value: [],
        failureReason: lookup.failureReason ?? 'Structured POI lookup failed',
        provenance: {
          sourceClass: 'STRUCTURED_POI',
          status: 'FAILED',
          radiusMeters: options.radiusMeters,
          rawResultCount: lookup.rawResultCount,
        },
      };
    }

    const value = lookup.value.map(
      (candidate): StructuredPoiCandidate => ({
        provider: 'structured_poi',
        externalId: candidate.id,
        title: candidate.name,
        evidenceType: 'place',
        evidenceKey: `osm:${candidate.osmType}:${candidate.osmId}`,
        geo: {
          latitude:
            candidate.geometry.type === 'Point'
              ? candidate.geometry.coordinates[1]
              : undefined,
          longitude:
            candidate.geometry.type === 'Point'
              ? candidate.geometry.coordinates[0]
              : undefined,
          geometry: candidate.geometry,
        },
        metadata: {
          osmType: candidate.osmType,
          osmId: candidate.osmId,
          tags: candidate.tags,
        },
        canonicalIdentity: {
          wikidataQid: candidate.tags.wikidata,
        },
        osmType: candidate.osmType,
        osmId: candidate.osmId,
        tags: candidate.tags,
        osmGeometry: candidate.geometry,
        memberIds: candidate.memberIds,
        identityMemberIds: candidate.identityMemberIds,
        admissionFacts: osmTagsToAdmissionFacts(candidate.tags),
        openingHoursEvidence: osmTagsToOpeningHoursEvidence(candidate.tags),
        visitUnitFacts: osmTagsToVisitUnitFacts(candidate.tags),
        visitDurationEvidence: osmTagsToVisitDurationEvidence(candidate.tags),
        originationCapabilities: [],
      }),
    );

    return {
      status: 'success',
      value,
      provenance: {
        sourceClass: 'STRUCTURED_POI',
        status: 'SUCCEEDED',
        destinationName: destination.destinationName,
        radiusMeters: options.radiusMeters,
        rawResultCount: lookup.rawResultCount,
        candidateCount: value.length,
      },
    };
  }
}
