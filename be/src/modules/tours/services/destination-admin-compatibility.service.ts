import { Injectable } from '@nestjs/common';
import {
  OsmAdminUnit,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { Coordinates } from '@shared/utils/distance.utils';

/**
 * Destination compatibility decided from ADMINISTRATIVE facts, never from
 * distance: a component candidate is compatible with the already-resolved
 * destination only when the destination's own admin unit (its OSM boundary
 * relation) contains the candidate, and the countries agree.
 *
 * The authority is the DESTINATION (e.g. Ciudad Autónoma de Buenos Aires),
 * not a neighborhood anchor (e.g. San Telmo): a Plaza de Mayo component of a
 * San Telmo walk is compatible because it is inside the destination, whether
 * or not it is inside the anchor. Anchor containment belongs to Experience
 * geographic validation, not to canonical identity acquisition.
 *
 * Fail closed: without a resolved destination boundary, or when the lookup
 * fails, the verdict is UNKNOWN -- callers must not treat UNKNOWN as
 * COMPATIBLE.
 */

export interface DestinationAdminBoundary {
  osmType: 'relation' | 'way';
  osmId: number;
  adminLevel?: number;
  name?: string;
}

export interface DestinationAdminContext {
  name: string;
  countryCode?: string;
  /** Absent for a point-scale destination: compatibility is then UNKNOWN. */
  boundary?: DestinationAdminBoundary;
}

export type AdminUnitFact = OsmAdminUnit;

export type DestinationCompatibilityVerdict =
  | 'COMPATIBLE'
  | 'INCOMPATIBLE'
  | 'UNKNOWN';

export type DestinationCompatibilityReason =
  | 'WITHIN_DESTINATION_ADMIN_UNIT'
  | 'OUTSIDE_DESTINATION_ADMIN_UNIT'
  | 'COUNTRY_MISMATCH'
  | 'CANDIDATE_NOT_WITHIN_DESTINATION'
  | 'DESTINATION_BOUNDARY_UNKNOWN'
  | 'ADMIN_LOOKUP_FAILED'
  | 'ADMIN_HIERARCHY_EMPTY';

export interface DestinationCompatibilityResult {
  verdict: DestinationCompatibilityVerdict;
  reason: DestinationCompatibilityReason;
  /** Containing admin units of the probe point, coarse to fine. */
  candidateHierarchy: AdminUnitFact[];
  candidateCountryCode?: string;
}

/** The candidate's own OSM object, when it is itself an admin unit. */
export interface CandidateSelfReference {
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
}

@Injectable()
export class DestinationAdminCompatibilityService {
  constructor(private readonly osmPlaces: OsmPlacesService) {}

  async evaluate(
    probePoint: Coordinates,
    destination: DestinationAdminContext,
    candidateSelf?: CandidateSelfReference,
  ): Promise<DestinationCompatibilityResult> {
    const boundary = destination.boundary;
    if (!boundary) {
      return {
        verdict: 'UNKNOWN',
        reason: 'DESTINATION_BOUNDARY_UNKNOWN',
        candidateHierarchy: [],
      };
    }

    const lookup = await this.osmPlaces.lookupContainingAdminUnits(probePoint);
    if (lookup.status === 'failed') {
      return {
        verdict: 'UNKNOWN',
        reason: 'ADMIN_LOOKUP_FAILED',
        candidateHierarchy: [],
      };
    }
    const hierarchy = lookup.value;
    if (hierarchy.length === 0) {
      return {
        verdict: 'UNKNOWN',
        reason: 'ADMIN_HIERARCHY_EMPTY',
        candidateHierarchy: [],
      };
    }

    const candidateCountryCode = hierarchy.find(
      (unit) => unit.adminLevel === 2 && unit.countryCode,
    )?.countryCode;
    const result = (
      verdict: DestinationCompatibilityVerdict,
      reason: DestinationCompatibilityReason,
    ): DestinationCompatibilityResult => ({
      verdict,
      reason,
      candidateHierarchy: hierarchy,
      ...(candidateCountryCode ? { candidateCountryCode } : {}),
    });

    if (
      destination.countryCode &&
      candidateCountryCode &&
      candidateCountryCode !== destination.countryCode.toUpperCase()
    ) {
      return result('INCOMPATIBLE', 'COUNTRY_MISMATCH');
    }

    const containedByDestination = hierarchy.some(
      (unit) =>
        unit.osmType === boundary.osmType && unit.osmId === boundary.osmId,
    );
    if (!containedByDestination) {
      return result('INCOMPATIBLE', 'OUTSIDE_DESTINATION_ADMIN_UNIT');
    }

    // Inside the destination's admin unit -- but a candidate that is itself
    // the destination, or an admin unit at or above the destination's
    // level whose probe point merely falls inside it, is still not a
    // component WITHIN the destination.
    if (candidateSelf) {
      const isDestination =
        candidateSelf.osmType === boundary.osmType &&
        candidateSelf.osmId === boundary.osmId;
      const selfUnit = hierarchy.find(
        (unit) =>
          unit.osmType === candidateSelf.osmType &&
          unit.osmId === candidateSelf.osmId,
      );
      const notFiner =
        selfUnit?.adminLevel !== undefined &&
        boundary.adminLevel !== undefined &&
        selfUnit.adminLevel <= boundary.adminLevel;
      if (isDestination || notFiner) {
        return result('INCOMPATIBLE', 'CANDIDATE_NOT_WITHIN_DESTINATION');
      }
    }

    return result('COMPATIBLE', 'WITHIN_DESTINATION_ADMIN_UNIT');
  }
}
