import { NominatimApiService } from '../../../../be/src/modules/integrations/osm/services/nominatim-api.service';
import { OsmCandidate, OsmPlacesService } from '../../../../be/src/modules/integrations/osm/services/osm-places.service';
import {
  EntityCandidate,
  GeographicScope,
  IdentityEvidence,
  IdentityVerdict,
} from '../../../../be/src/modules/tours/interfaces/experience-resolution.interface';
import { IdentityVerifier } from '../../../../be/src/modules/tours/services/identity-verifier.service';
import { TargetedRouteResolverService } from '../../../../be/src/modules/tours/services/targeted-route-resolver.service';
import { structuralKindFromNominatim } from '../../../../be/src/modules/tours/utils/candidate-structural-kind.util';
import { normalizeGeoName } from '../../../../be/src/modules/tours/utils/nominatim-match.util';
import { GeoEntityKind, GeoEntityRef, GeoGeometry, LngLat } from '../contracts';
import { anchorOnLine, centroidOf, containsPoint, distanceMeters } from '../geometry';
import { CatalogStore, GeographyResolutionAuthority } from '../stores';

/** Result of geographic identity resolution. Only RESOLVED can reach L1. */
export type IdentityResult =
  | { status: 'RESOLVED'; entity: GeoEntityRef; rule: string }
  | { status: 'AMBIGUOUS' | 'NOT_FOUND' | 'INCOMPATIBLE'; detail: string }
  | { status: 'UNAVAILABLE'; detail: string };

export interface ResolutionScope {
  destination: GeoEntityRef;
  /** An area the evidence or the gap bounds the subject to. */
  area?: GeoEntityRef;
  /** Whether `area` was named by the source (vs. the gap's scope). */
  areaNamedBySource?: boolean;
  /**
   * A verified, source-named street the subject is stated to lie on (a
   * corridor endpoint). SPIKE FINDING: the backend correspondence
   * vocabulary has no route basis; proximity to the verified route is
   * mapped to SOURCE_AREA here and must become an explicit basis in
   * production.
   */
  nearRoute?: { vertices: LngLat[]; toleranceMeters: number };
}

export interface GeoResolver {
  resolveArea(mention: string, scope: ResolutionScope): Promise<IdentityResult>;
  resolvePlace(mention: string, scope: ResolutionScope): Promise<IdentityResult>;
  resolveRoute(mention: string, scope: ResolutionScope): Promise<IdentityResult>;
}

const GEOGRAPHY = new GeographyResolutionAuthority();

/**
 * The only path into L1: a RESOLVED identity result is recorded through the
 * geography-resolution authority. Grounding never constructs L1 entities.
 */
export function recordResolved(store: CatalogStore, result: Extract<IdentityResult, { status: 'RESOLVED' }>): GeoEntityRef {
  return store.recordGeoEntity(GEOGRAPHY, result.entity);
}

function entityFromOsm(candidate: OsmCandidate, kind: GeoEntityKind): GeoEntityRef {
  const geometry = candidate.geometry as unknown as GeoGeometry;
  return {
    id: `geo:${candidate.id}`,
    kind,
    name: candidate.name,
    identities: [{ provider: 'openstreetmap', externalId: candidate.id }],
    geometry,
    centroid: centroidOf(geometry),
  };
}

function verdictToResult(verdict: IdentityVerdict, entity: GeoEntityRef, detail: string): IdentityResult {
  switch (verdict.status) {
    case 'VERIFIED':
      return { status: 'RESOLVED', entity, rule: verdict.rule };
    case 'AMBIGUOUS':
      return { status: 'AMBIGUOUS', detail: `${verdict.rule}: ${detail}` };
    case 'REJECTED':
      return { status: 'INCOMPATIBLE', detail: `${verdict.rule}: ${detail}` };
    default:
      return { status: 'NOT_FOUND', detail: `${verdict.rule}: insufficient identity evidence (${detail})` };
  }
}

function candidateOf(entity: GeoEntityRef, mention: string, role: EntityCandidate['role']): EntityCandidate {
  return {
    hintKey: normalizeGeoName(mention),
    hintName: mention,
    provider: entity.identities[0].provider,
    externalId: entity.identities[0].externalId,
    canonicalName: entity.name,
    kind: entity.kind,
    latitude: entity.centroid.lat,
    longitude: entity.centroid.lng,
    role,
    nameEvidenceMultiplicity: { exactName: 'UNKNOWN', declaredAlias: 'UNKNOWN' },
  };
}

/** Generic street designators a source may prepend ("Calle Defensa"). */
const STREET_DESIGNATOR = /^(calle|avenida|av\.?|pasaje|street|st\.?)\s+/i;
const NEAR_DUPLICATE_METERS = 150;

/**
 * Real geographic identity resolution over the backend's OSM/Nominatim
 * adapters, with every verdict decided by the backend IdentityVerifier.
 */
export class OsmGeoResolver implements GeoResolver {
  private readonly verifier = new IdentityVerifier();
  private neighborhoodCache?: { destinationId: string; pool: OsmCandidate[] };

  constructor(
    private readonly osm: OsmPlacesService,
    private readonly nominatim: NominatimApiService,
    private readonly routes: TargetedRouteResolverService,
    private readonly destinationBoundary: OsmCandidate,
    private readonly countryCode?: string,
  ) {}

  private async neighborhoods(destination: GeoEntityRef): Promise<OsmCandidate[] | undefined> {
    if (this.neighborhoodCache?.destinationId === destination.id) return this.neighborhoodCache.pool;
    const lookup = await this.osm.lookupNeighborhoodsWithin(this.destinationBoundary);
    if (lookup.status !== 'success') return undefined;
    this.neighborhoodCache = { destinationId: destination.id, pool: lookup.value };
    return lookup.value;
  }

  async resolveArea(mention: string, scope: ResolutionScope): Promise<IdentityResult> {
    const pool = await this.neighborhoods(scope.destination);
    if (!pool) return { status: 'UNAVAILABLE', detail: 'neighbourhood lookup failed' };
    const key = normalizeGeoName(mention.replace(/^barrio\s+(de\s+)?/i, ''));
    const matches = pool.filter((c) => normalizeGeoName(c.name) === key);
    if (matches.length === 0) return { status: 'NOT_FOUND', detail: `no neighbourhood named "${mention}" within the destination` };
    const entity = entityFromOsm(matches[0], 'AREA');
    const evidence: IdentityEvidence[] = [
      { type: 'EXACT_NAME', identityMultiplicity: matches.length === 1 ? 'SINGLE' : 'MULTIPLE' },
      // The pool is every administrative neighbourhood of the destination.
      { type: 'GEOGRAPHIC_CORRESPONDENCE', basis: 'BOUNDED_ADMISSION_SCOPE' },
      {
        type: 'COMPETITOR_EXAMINATION',
        outcome: matches.length > 1 ? 'MATERIAL_COMPETITOR_KNOWN' : 'NO_MATERIAL_COMPETITOR',
        examinedStrategies: ['LOCAL_OSM_POOL'],
        competitorCount: matches.length - 1,
      },
    ];
    const verdict = this.verifier.decide({ name: mention }, { strategy: 'LOCAL_OSM_POOL', candidate: candidateOf(entity, mention, 'area'), evidence });
    const result = verdictToResult(verdict, entity, `${matches.length} exact match(es) among ${pool.length} neighbourhoods`);
    if (result.status !== 'RESOLVED') return result;
    // The neighbourhood pool carries centers only; hydrate the real boundary
    // so containment checks use provider geometry (never a point).
    const match = matches[0];
    if (match.osmType === 'node') return { status: 'UNAVAILABLE', detail: 'neighbourhood without boundary geometry' };
    const hydrated = await this.osm.lookupBoundaryById(match.osmType, match.osmId);
    if (hydrated.status !== 'success' || !hydrated.value) return { status: 'UNAVAILABLE', detail: `boundary hydration failed for ${match.id}` };
    return { ...result, entity: entityFromOsm(hydrated.value, 'AREA') };
  }

  async resolvePlace(mention: string, scope: ResolutionScope): Promise<IdentityResult> {
    let results;
    try {
      const query = [mention, scope.area?.name, scope.destination.name].filter(Boolean).join(', ');
      results = await this.nominatim.search(query, {
        ...(this.countryCode ? { countryCode: this.countryCode } : {}),
        resultWindow: 'PROVIDER_MAXIMUM',
      });
    } catch (error) {
      return { status: 'UNAVAILABLE', detail: (error as Error).message };
    }
    const key = normalizeGeoName(mention);
    // Canonical structural kind: transit stops, roads, settlements and admin
    // units named after a landmark are not the visitable place.
    const visitable = results.filter((r) => ['POINT_OF_INTEREST', 'NATURAL_FEATURE', 'UNKNOWN'].includes(structuralKindFromNominatim(r)));
    const inDestination = visitable.filter(
      (r) => r.latitude !== undefined && r.longitude !== undefined && containsPoint(scope.destination.geometry, { lng: r.longitude, lat: r.latitude }),
    );
    const exact = inDestination.filter((r) => normalizeGeoName(r.displayName.split(',')[0]) === key);
    if (exact.length === 0) {
      return { status: inDestination.length ? 'NOT_FOUND' : results.length ? 'INCOMPATIBLE' : 'NOT_FOUND', detail: `no exact "${mention}" inside the destination (${results.length} results)` };
    }
    // Spike record-equivalence: exact-name records within ~150 m are one
    // physical entity (a plaza as node + way); prefer the way/relation.
    const clusters: typeof exact[] = [];
    for (const r of exact.sort((a, b) => (a.osmType === 'node' ? 1 : 0) - (b.osmType === 'node' ? 1 : 0) || a.osmId - b.osmId)) {
      const p = { lng: r.longitude as number, lat: r.latitude as number };
      const home = clusters.find((c) => distanceMeters({ lng: c[0].longitude as number, lat: c[0].latitude as number }, p) <= NEAR_DUPLICATE_METERS);
      if (home) home.push(r);
      else clusters.push([r]);
    }
    const chosen = clusters[0][0];
    const point = { lng: chosen.longitude as number, lat: chosen.latitude as number };
    // Hydrate provider geometry for ways/relations (a park is a polygon);
    // the representative point stays the provider's own point.
    let geometry: GeoGeometry = { type: 'Point', coordinates: [point.lng, point.lat] };
    if (chosen.osmType !== 'node') {
      const hydrated = await this.osm.lookupBoundaryById(chosen.osmType, chosen.osmId);
      if (hydrated.status === 'success' && hydrated.value) geometry = hydrated.value.geometry as unknown as GeoGeometry;
    }
    const entity: GeoEntityRef = {
      id: `geo:osm:${chosen.osmType}:${chosen.osmId}`,
      kind: 'PLACE',
      name: chosen.displayName.split(',')[0].trim(),
      identities: clusters[0].map((r) => ({ provider: 'openstreetmap', externalId: `osm:${r.osmType}:${r.osmId}` })),
      geometry,
      centroid: point,
    };
    const insideArea = scope.area ? containsPoint(scope.area.geometry, point) : false;
    const onRoute = scope.nearRoute ? anchorOnLine(geometry, scope.nearRoute.vertices).meters <= scope.nearRoute.toleranceMeters : false;
    const basis = insideArea
      ? scope.areaNamedBySource ? 'SOURCE_AREA' : 'BOUNDED_ADMISSION_SCOPE'
      : onRoute ? 'SOURCE_AREA' : 'ADMISSION_SCOPE_ONLY';
    const evidence: IdentityEvidence[] = [
      { type: 'EXACT_NAME', identityMultiplicity: clusters.length === 1 ? 'SINGLE' : 'MULTIPLE' },
      { type: 'GEOGRAPHIC_CORRESPONDENCE', basis },
      {
        type: 'COMPETITOR_EXAMINATION',
        outcome: clusters.length > 1 ? 'MATERIAL_COMPETITOR_KNOWN' : 'NO_MATERIAL_COMPETITOR',
        examinedStrategies: ['NOMINATIM'],
        competitorCount: clusters.length - 1,
      },
    ];
    const verdict = this.verifier.decide({ name: mention }, { strategy: 'NOMINATIM', candidate: candidateOf(entity, mention, 'venue'), evidence });
    return verdictToResult(verdict, entity, `${clusters.length} distinct exact-name entities in destination; correspondence ${basis}${onRoute && !insideArea ? ' (route proximity)' : ''}`);
  }

  async resolveRoute(mention: string, _scope: ResolutionScope): Promise<IdentityResult> {
    const destination: GeographicScope = { kind: 'AREA_BOUNDARY', boundary: this.destinationBoundary };
    const name = mention.replace(STREET_DESIGNATOR, '').trim();
    const result = await this.routes.resolve({ name, destination });
    if (result.status === 'UNAVAILABLE') return { status: 'UNAVAILABLE', detail: result.reason };
    if (result.status === 'NOT_FOUND' || result.status === 'INCOMPATIBLE') return { status: result.status, detail: result.reason };
    const cluster = result.resolved ?? result.clusters.find((c) => c.compatibility.verdict === 'COMPATIBLE') ?? result.clusters[0];
    const geometry: GeoGeometry = { type: 'MultiLineString', coordinates: cluster.segments.map((s) => s.coordinates) };
    const entity: GeoEntityRef = {
      id: `geo:osm-route:${cluster.segmentExternalIds[0]}`,
      kind: 'ROUTE',
      name: cluster.canonicalName,
      identities: cluster.segmentExternalIds.map((externalId) => ({ provider: 'openstreetmap', externalId })),
      geometry,
      centroid: centroidOf(geometry),
    };
    const evidence: IdentityEvidence[] = [
      {
        type: 'STRUCTURED_ROUTE_RESOLUTION',
        provider: 'openstreetmap',
        segmentExternalIds: cluster.segmentExternalIds,
        destinationCompatibility: cluster.compatibility.verdict,
        ambiguity: result.compatibleClusterCount > 1 ? 'MULTIPLE_CLUSTERS' : 'SINGLE_CLUSTER',
      },
    ];
    const verdict = this.verifier.decide({ name: mention }, { strategy: 'TARGETED_ROUTE', candidate: candidateOf(entity, mention, 'route'), evidence });
    return verdictToResult(verdict, entity, `${result.status}/${result.reason}, ${result.compatibleClusterCount} compatible cluster(s)`);
  }
}
