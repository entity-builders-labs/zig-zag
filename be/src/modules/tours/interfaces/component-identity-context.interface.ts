import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  ComponentLocalityAssertion,
  ComponentPhysicalKind,
  ComponentPhysicalKindAssertion,
} from './experience-discovery.interface';

/**
 * Contextual physical-identity verification (RW4, 2026-10-03).
 *
 * The source's component-specific assertions (a locality, a physical kind)
 * are SOURCE facts. A candidate's coordinates and structural kind are
 * CANDIDATE facts from its own provider record. Comparing the two is
 * contextual compatibility; it becomes discriminating correspondence only
 * when the examined same-name pool holds exactly one compatible member and
 * the comparison is known to be complete for the asserted locality.
 */

/**
 * Structural kind of a provider record, normalized at the provider
 * boundary. Coarse on purpose: compatibility is "is this a venue or a
 * settlement/area/road", never a category match.
 */
export type CandidateStructuralKind =
  | 'POINT_OF_INTEREST'
  | 'SETTLEMENT'
  | 'ADMINISTRATIVE_AREA'
  | 'ROAD'
  | 'NATURAL_FEATURE'
  /** Public-transport infrastructure (a stop, platform or station node)
   * that is often named after the landmark it serves. */
  | 'TRANSPORT_STOP'
  /** A postal unit (postcode area). */
  | 'POSTAL_UNIT'
  | 'UNKNOWN';

/**
 * A source locality resolved to a real administrative boundary. GROUNDED
 * only when the asserted name resolves to exactly one boundary in the
 * destination country; anything else is explicit missing evidence.
 */
export type LocalityGrounding =
  | {
      status: 'GROUNDED';
      assertion: ComponentLocalityAssertion;
      boundary: {
        provider: 'openstreetmap';
        externalId: string;
        name: string;
        geometry: GeoJsonGeometry;
      };
    }
  | {
      status: 'UNGROUNDED';
      assertion: ComponentLocalityAssertion;
      reason:
        | 'NO_BOUNDARY'
        | 'AMBIGUOUS_BOUNDARY'
        | 'NO_COUNTRY'
        | 'NO_GROUNDER'
        | 'PROVIDER_FAILURE';
    };

export interface ComponentIdentityContext {
  locality?: LocalityGrounding;
  physicalKind?: ComponentPhysicalKindAssertion;
}

/**
 * Grounds a component's source-asserted locality in a real administrative
 * boundary before identity acquisition. Never throws for a missing or
 * ambiguous boundary: that is an UNGROUNDED fact.
 */
export interface ComponentLocalityGrounder {
  groundLocality(
    assertion: ComponentLocalityAssertion,
    countryCode: string | undefined,
  ): Promise<LocalityGrounding>;
}

export const COMPONENT_LOCALITY_GROUNDER = 'ComponentLocalityGrounder';

/** One member of the same-name pool a strategy examined. */
export interface ContextualPoolMember {
  /** `${provider}/${externalId}` of the member's acquisition identity. */
  identityKey: string;
  latitude?: number;
  longitude?: number;
  structuralKind: CandidateStructuralKind;
}

/**
 * Whether the examined pool can be a complete comparison for the asserted
 * locality. `PROVIDER_WINDOW_NOT_REACHED` means the provider returned fewer
 * results than requested: the request limit did not truncate the pool. It
 * is NOT proof of global completeness, only that the provider's own answer
 * was not cut off. `COVERS_ASSERTED_LOCALITY` means a snapshot enumerated
 * an extent (or the country) containing the locality's boundary.
 * `NOT_ESTABLISHED` covers a pool bounded to another area, a saturated
 * window, or a partial snapshot that does not cover the locality.
 */
/**
 * A WGS84 bounding box inside which a provider snapshot holds EVERY record
 * of its release (an operational import by extent, not a sample). It is
 * what a partial snapshot can claim completeness over.
 */
export interface EnumeratedExtent {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type ContextualPoolCoverage =
  | 'PROVIDER_WINDOW_NOT_REACHED'
  | 'COVERS_ASSERTED_LOCALITY'
  | 'NOT_ESTABLISHED';

export type ContextualPoolOutcome =
  /** Exactly one compatible member and a complete comparison. */
  | 'DISTINGUISHED'
  /** Two or more members are equally consistent with the source facts. */
  | 'AMBIGUOUS'
  /** No member is consistent with the source facts. */
  | 'NO_CONSISTENT_MEMBER'
  /** One consistent member, but the comparison is not known complete. */
  | 'INCOMPLETE_COMPARISON'
  /** One consistent member, but its kind cannot be shown compatible. */
  | 'KIND_UNESTABLISHED';

export interface ContextualPoolEvaluation {
  assertion: 'LOCALITY';
  locality: string;
  boundaryId: string;
  coverage: ContextualPoolCoverage;
  memberCount: number;
  /** Members inside the locality whose kind is not incompatible. */
  consistentIdentityKeys: string[];
  /** Members whose position cannot be compared to the boundary. */
  undeterminedIdentityKeys: string[];
  assertedKind?: ComponentPhysicalKind;
  outcome: ContextualPoolOutcome;
}
