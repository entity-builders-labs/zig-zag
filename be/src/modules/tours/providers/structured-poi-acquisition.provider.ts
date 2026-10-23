import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { osmTagsToProminenceEvidence } from '@integrations/osm/utils/osm-admission-adapter';
import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';
import {
  WikidataAdmissionFacts,
  wikidataStructuredFactsToAdmissionFacts,
  wikidataStructuredFactsToProminenceEvidence,
} from '@integrations/wikidata/utils/wikidata-admission-adapter';
import { ProminenceEvidenceFact } from '../prominence/structured-prominence.policy';

/**
 * Identity-linked encyclopedic facts of a candidate's QID (design C17). KNOWN
 * carries adapter-normalized admission facts and prominence evidence;
 * NOT_FOUND means the provider reports no such item; UNAVAILABLE means the
 * lookup failed or was not executed. The last two are UNKNOWN, never
 * negative evidence.
 */
export type StructuredEntityFactsOutcome =
  | {
      status: 'KNOWN';
      qid: string;
      admission: WikidataAdmissionFacts;
      prominence: ProminenceEvidenceFact[];
    }
  | { status: 'NOT_FOUND' | 'UNAVAILABLE'; qid: string };

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
  /** Typed OSM prominence evidence of this record (heritage, visitor class). */
  prominenceEvidence: ProminenceEvidenceFact[];
  /** Present only when the candidate carries a QID and entity facts were planned. */
  entityFacts?: StructuredEntityFactsOutcome;
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
  constructor(
    private readonly osmPlaces: OsmPlacesService,
    @Optional()
    @Inject('WikidataApiService')
    private readonly wikidata?: IWikidataApiService,
  ) {}

  async acquire(
    destination: ExperienceDiscoveryScope,
    options: {
      radiusMeters: number;
      entityFacts?: { sourceClass: 'STRUCTURED_ENTITY_FACTS' };
    },
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

    const observedAt = new Date();
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
        prominenceEvidence: osmTagsToProminenceEvidence(
          candidate.tags,
          `osm:${candidate.osmType}:${candidate.osmId}`,
          observedAt,
        ),
        originationCapabilities: [],
      }),
    );
    const entityFacts = options.entityFacts
      ? await this.attachEntityFacts(value)
      : undefined;

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
        ...(entityFacts ? { entityFacts } : {}),
      },
    };
  }

  /**
   * Dependent STRUCTURED_ENTITY_FACTS batch for the QIDs the candidates carry.
   * Never fails the OSM discovery: an unavailable provider or failed batch
   * leaves those QIDs UNAVAILABLE (UNKNOWN downstream).
   */
  private async attachEntityFacts(candidates: StructuredPoiCandidate[]) {
    const qids = [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.canonicalIdentity?.wikidataQid
            ? [candidate.canonicalIdentity.wikidataQid]
            : [],
        ),
      ),
    ].sort();
    if (qids.length === 0) {
      return {
        sourceClass: 'STRUCTURED_ENTITY_FACTS',
        status: 'SUCCEEDED',
        requested: 0,
        known: 0,
        notFound: 0,
        unavailable: 0,
      };
    }
    const outcome = this.wikidata
      ? await this.wikidata.lookupStructuredEntityFacts(qids)
      : undefined;
    for (const candidate of candidates) {
      const qid = candidate.canonicalIdentity?.wikidataQid;
      if (!qid) continue;
      const facts = outcome?.facts.get(qid);
      candidate.entityFacts = facts
        ? {
            status: 'KNOWN',
            qid,
            admission: wikidataStructuredFactsToAdmissionFacts(facts),
            prominence: wikidataStructuredFactsToProminenceEvidence(
              facts,
              outcome!.observedAt,
            ),
          }
        : {
            status: outcome?.missingQids.has(qid) ? 'NOT_FOUND' : 'UNAVAILABLE',
            qid,
          };
    }
    const known = outcome?.facts.size ?? 0;
    const notFound = outcome?.missingQids.size ?? 0;
    const unavailable = qids.length - known - notFound;
    return {
      sourceClass: 'STRUCTURED_ENTITY_FACTS',
      status: !outcome
        ? 'FAILED'
        : unavailable === 0
          ? 'SUCCEEDED'
          : known + notFound === 0
            ? 'FAILED'
            : 'PARTIAL',
      requested: qids.length,
      known,
      notFound,
      unavailable,
      ...(outcome ? { observedAt: outcome.observedAt.toISOString() } : {}),
    };
  }
}
