import { GeoEntityKind } from '@prisma/client';
import {
  EntityCandidate,
  IdentityEvidence,
} from '../interfaces/experience-resolution.interface';
import { EvaluatedRouteCluster } from '../services/targeted-route-resolver.service';

/**
 * One RESOLVED targeted route cluster as ONE transient candidate -- shared by
 * every ROUTE resolution caller (component resolver, anchor resolver) so the
 * canonical route identity shape has a single definition:
 *  - every segment is a real provider identity (`identities`), the longest
 *    segment is the representative `externalId`;
 *  - geometry is a MultiLineString of the real segment lines (gaps never
 *    bridged, segments never reordered into a synthetic polyline);
 *  - latitude/longitude are the middle vertex of the LONGEST segment (ties
 *    by way id): deterministic, on the street, never an identity fact.
 */
export function buildRouteClusterCandidate(
  hint: { key: string; name: string; role: EntityCandidate['role'] },
  cluster: EvaluatedRouteCluster,
): EntityCandidate {
  const representative = cluster.representativeSegment;
  return {
    hintKey: hint.key,
    hintName: hint.name,
    provider: 'openstreetmap',
    externalId: representative.externalId,
    canonicalName: cluster.canonicalName,
    kind: GeoEntityKind.ROUTE,
    latitude: representative.probePoint.latitude,
    longitude: representative.probePoint.longitude,
    geometry: {
      type: 'MultiLineString',
      coordinates: cluster.segments.map((segment) => segment.coordinates),
    },
    role: hint.role,
    expectedType: 'ROUTE',
    // Raw way multiplicity never establishes route name multiplicity.
    nameEvidenceMultiplicity: {
      exactName: 'UNKNOWN',
      declaredAlias: 'UNKNOWN',
    },
    identities: cluster.segmentExternalIds.map((externalId) => ({
      provider: 'openstreetmap',
      externalId,
    })),
    persistenceMetadata: {
      routeSegments: {
        segmentCount: cluster.geometryFacts.segmentCount,
        highwayTypes: cluster.geometryFacts.highwayTypes,
        totalLengthMeters: cluster.geometryFacts.totalLengthMeters,
      },
    },
  };
}

/** The typed structural fact IdentityVerifier judges for a RESOLVED cluster. */
export function structuredRouteEvidence(
  cluster: EvaluatedRouteCluster,
): IdentityEvidence {
  return {
    type: 'STRUCTURED_ROUTE_RESOLUTION',
    provider: 'openstreetmap',
    segmentExternalIds: [...cluster.segmentExternalIds],
    destinationCompatibility: cluster.compatibility.verdict,
    ambiguity: 'SINGLE_CLUSTER',
  };
}
