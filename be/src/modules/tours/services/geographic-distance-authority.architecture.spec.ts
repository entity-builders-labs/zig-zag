import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Spec 2026-10-02 Part II §P2-13 regression rule (milestone S6):
 *
 *   A geographic distance that decides a domain outcome lives in exactly one
 *   policy owner, is exported only as part of that owner's typed policy, and
 *   is never imported by another policy owner.
 *
 * Mechanical guards:
 *  1. superseded semantic contracts (the destination-centered 80 km
 *     "route-scale" domain, the 50 km plausibility bias, the coherence
 *     thresholds) never reappear in production code;
 *  2. destination compatibility and identity acquisition never import
 *     composite-coherence geometry/distance helpers;
 *  3. every NAMED distance constant in tours/integrations is registered
 *     below with its owner and §P2-3 status. A semantic authority can only
 *     be added together with a documented owner; an operational provider
 *     cap is registered as such and can never decide validity.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..');

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(SRC_ROOT, path);

describe('geographic distance authority (spec 2026-10-02 Part II §P2-13)', () => {
  const allProduction = productionFiles(SRC_ROOT);

  it('superseded geographic authorities are unreachable: no production code names them', () => {
    const forbidden = [
      /\brouteScale\b/,
      /\brouteScaleDestinationRadius\b/,
      /\bROUTE_SCALE\b/,
      /ROUTE_DESTINATION_RADIUS/,
      /\bauthorizesRouteScale\b/,
      /\brouteDestinationMismatch\b/,
      /\bDEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS\b/,
      /\bGeographicValidationThresholds\b/,
      /\bPLACES_FALLBACK_BIAS_RADIUS_METERS\b/,
      /\bNOMINATIM_BIAS_RADIUS_METERS\b/,
      /\bHIGHWAYS_BY_NAME_MAX_RADIUS_METERS\b/,
      // §P2-18: a missing canonical AREA is never a geographic verdict.
      /\bunknownWhenBeyondDestination\b/,
      /\bNO_VERIFIED_SCOPE_FOR_COMPONENTS_BEYOND_DESTINATION\b/,
      /\bMULTIPLE_CANDIDATE_SCOPES\b/,
      /\bOUTSIDE_EXPERIENCE_ROUTE_SCOPE\b/,
    ];
    const offenders = allProduction.flatMap((path) => {
      const source = read(path);
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${rel(path)}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it('§P2-18: source-composition support and membership semantics read no distance, provider or candidate-name fact', () => {
    for (const name of [
      '../utils/source-composition-support.policy.ts',
      '../utils/experience-geographic-scope.policy.ts',
    ]) {
      const source = read(join(__dirname, name));
      expect(source).not.toMatch(/geographic-coherence\.util/);
      expect(source).not.toMatch(/\bdistanceMeters\b|_RADIUS_METERS\b/);
      expect(source).not.toMatch(/google_places|geoapify|nominatim|overture/i);
    }
    // One owner decides whether a composition may extend beyond the
    // destination; acquisition and validation both ask it.
    for (const name of [
      'experience-proposal-resolver.service.ts',
      'composite-geographic-validation.service.ts',
    ]) {
      const source = read(join(__dirname, name));
      expect(source).toMatch(/\bmayExtendBeyondDestination\(/);
    }
  });

  it('§P2-18: regional catalog retrieval is bounded — never a scan of every VERIFIED Experience', () => {
    const catalog = read(join(__dirname, 'experience-catalog.service.ts'));
    const start = catalog.indexOf('async findVerifiedMultiComponentInArea(');
    const body = catalog.slice(start, catalog.indexOf('\n  }\n', start));
    expect(body).toMatch(/findVerifiedWithinForMatching\(/);
    expect(body).toMatch(/id: \{ in: ids \}/);
  });

  it('destination compatibility is polygon-only: it imports no centroid/distance helper and no threshold', () => {
    const policy = read(
      join(__dirname, '../utils/destination-compatibility.policy.ts'),
    );
    expect(policy).not.toMatch(/geographic-coherence\.util/);
    expect(policy).not.toMatch(/\bcentroidOfGeometry\b|\bdistanceMeters\b/);
    expect(policy).not.toMatch(/geographic-validation\.interface/);
  });

  it('identity acquisition derives search windows from scope geometry: the resolver imports no coherence/distance helper', () => {
    for (const name of [
      'experience-proposal-resolver.service.ts',
      'area-route-anchor-resolver.service.ts',
    ]) {
      const source = read(join(__dirname, name));
      expect(source).not.toMatch(/geographic-coherence\.util/);
      expect(source).not.toMatch(/\bcentroidOfGeometry\b/);
    }
    // The only search-window derivation is the scope policy's.
    expect(
      read(join(__dirname, 'experience-proposal-resolver.service.ts')),
    ).toMatch(/scopeSearchWindow\(/);
  });

  it('authorization never maps to geometry: the authorization util exposes no radius/scale predicate', () => {
    const util = read(
      join(__dirname, '../utils/geographic-validation-authorization.util.ts'),
    );
    expect(util).not.toMatch(/Radius|Scale|Meters/);
  });

  /**
   * Every named distance constant (`*RADIUS*_METERS`, `*DISTANCE*_METERS`)
   * in tours/integrations production code. Status vocabulary from §P2-3.
   * PHYSICAL = a physical constant; PROVIDER_CONSTRAINT = an operational
   * provider/load cap that must never decide validity; UNKNOWN = value
   * pending a characterization owned elsewhere (never borrowed here).
   */
  const REGISTRY: Record<string, { owner: string; status: string }> = {
    'modules/tours/utils/geometry-search-area.util.ts:EARTH_RADIUS_METERS': {
      owner: 'geometry',
      status: 'PHYSICAL',
    },
    'modules/tours/utils/geographic-coherence.util.ts:EARTH_RADIUS_METERS': {
      owner: 'geometry',
      status: 'PHYSICAL',
    },
    'modules/integrations/osm/utils/geojson-containment.util.ts:EARTH_RADIUS_METERS':
      { owner: 'geometry', status: 'PHYSICAL' },
    // T18: identity dedupe proximity (owner documented; value UNKNOWN).
    'modules/tours/utils/candidate-overlap-filter.util.ts:OVERLAP_RADIUS_METERS':
      { owner: 'identity dedupe', status: 'UNKNOWN' },
    'modules/tours/utils/real-world-entity-matching.util.ts:REAL_WORLD_RECONCILIATION_RADIUS_METERS':
      { owner: 'identity dedupe', status: 'UNKNOWN' },
    'modules/tours/services/experience-catalog.service.ts:GEO_ENTITY_RECONCILIATION_RADIUS_METERS':
      { owner: 'identity dedupe', status: 'UNKNOWN' },
    // T17: Wikidata corroboration search (owner documented; value UNKNOWN).
    'modules/tours/services/identity-evidence-collector.service.ts:CONFIRMATION_RADIUS_METERS':
      { owner: 'identity evidence', status: 'UNKNOWN' },
    // T16: destination disambiguation tolerance (destination resolution only).
    'modules/tours/services/destination-resolution.service.ts:MAX_DESTINATION_DISTANCE_METERS':
      { owner: 'destination resolution', status: 'UNKNOWN' },
    'modules/tours/services/destination-resolution.service.ts:MAX_POINT_DESTINATION_DISTANCE_METERS':
      { owner: 'destination resolution', status: 'UNKNOWN' },
    // T13: Places Nearby coverage circles (API coverage geometry).
    'modules/tours/services/catalog-refill-anchor-planner.service.ts:MAX_ANCHOR_RADIUS_METERS':
      { owner: 'catalog refill', status: 'PROVIDER_CONSTRAINT' },
    'modules/tours/services/catalog-refill-anchor-planner.service.ts:MIN_ANCHOR_RADIUS_METERS':
      { owner: 'catalog refill', status: 'PROVIDER_CONSTRAINT' },
    'modules/tours/services/catalog-refill-anchor-planner.service.ts:DEFAULT_CHILD_AREA_RADIUS_METERS':
      { owner: 'catalog refill', status: 'PROVIDER_CONSTRAINT' },
    // T11/T12: Overpass load caps.
    'modules/integrations/osm/utils/overpass-query.util.ts:FEATURES_NEAR_MAX_RADIUS_METERS':
      { owner: 'OSM adapter', status: 'PROVIDER_CONSTRAINT' },
    'modules/integrations/osm/utils/overpass-query.util.ts:HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS':
      { owner: 'OSM adapter', status: 'PROVIDER_CONSTRAINT' },
    'modules/integrations/osm/services/osm-places.service.ts:DEFAULT_MAX_STREETS_RADIUS_METERS':
      { owner: 'OSM adapter', status: 'PROVIDER_CONSTRAINT' },
    'modules/integrations/osm/services/osm-places.service.ts:DEFAULT_MAX_FEATURES_RADIUS_METERS':
      { owner: 'OSM adapter', status: 'PROVIDER_CONSTRAINT' },
    // Google Places API circle-bias maximum (adapter switches to a rectangle).
    'modules/integrations/google-places/services/google-places-api.service.ts:GOOGLE_CIRCLE_BIAS_MAX_RADIUS_METERS':
      { owner: 'Google Places adapter', status: 'PROVIDER_CONSTRAINT' },
  };

  it('every named distance constant is registered with an owner and a non-semantic or owned status', () => {
    const declared = productionFiles(join(SRC_ROOT, 'modules'))
      .filter(
        (path) =>
          rel(path).startsWith('modules/tours/') ||
          rel(path).startsWith('modules/integrations/'),
      )
      .flatMap((path) =>
        [
          ...read(path).matchAll(
            /const ([A-Z0-9_]*(?:RADIUS|DISTANCE)[A-Z0-9_]*METERS)\s*=/g,
          ),
        ].map((match) => `${rel(path)}:${match[1]}`),
      )
      .sort();
    expect(declared).toEqual(Object.keys(REGISTRY).sort());
    expect(
      Object.values(REGISTRY).filter(
        (entry) =>
          !['PHYSICAL', 'PROVIDER_CONSTRAINT', 'UNKNOWN'].includes(
            entry.status,
          ),
      ),
    ).toEqual([]);
  });

  it('no production code reintroduces a coherence-threshold object (*RadiusMeters / *PairwiseDistanceMeters literals)', () => {
    const offenders = productionFiles(join(SRC_ROOT, 'modules'))
      .filter((path) => !rel(path).includes('/fixtures/'))
      .flatMap((path) =>
        [
          ...read(path).matchAll(
            /\b(max\w*RadiusMeters|max\w*PairwiseDistanceMeters)\s*:\s*\d/g,
          ),
        ].map((match) => `${rel(path)}:${match[1]}`),
      );
    expect(offenders).toEqual([]);
  });
});
