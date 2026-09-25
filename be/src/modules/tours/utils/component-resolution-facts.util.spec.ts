import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  ComponentResolutionAudit,
  ResolutionAttemptAudit,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import { buildCompositeComponentResolution } from './component-resolution-facts.util';

/**
 * Stage 4 component truth: identity and geography are separate facts, and
 * every source-backed component stays visible. Geometry is real (no mocked
 * policy); the synthetic polygon stands in for San Telmo
 * (osm:relation:2223069), as in the Stage 1 Case C/D fixtures.
 */
const SAN_TELMO: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-58.373, -34.622],
      [-58.368, -34.622],
      [-58.368, -34.617],
      [-58.373, -34.617],
      [-58.373, -34.622],
    ],
  ],
};
const SAN_TELMO_SCOPE = {
  kind: 'AREA' as const,
  anchorName: 'San Telmo',
  geoEntityId: 'geo-san-telmo',
  geometry: SAN_TELMO,
};

type Hint = ExperienceCandidate['componentHints'][number];
const hint = (
  key: string,
  role: Hint['role'],
  expectedKind: Hint['expectedKind'],
): Hint => ({ key, name: key, role, expectedKind, evidenceKeys: ['ev-1'] });

const candidate = (
  hints: Hint[],
  orderedByEvidence = false,
): ExperienceCandidate => ({
  name: 'San Telmo Historic Walk',
  themes: ['history'],
  traits: [],
  evidenceKeys: ['ev-1'],
  shortReason: 'evidenced walk',
  orderedByEvidence,
  componentHints: hints,
});

const resolvedEntity = (
  hintKey: string,
  role: ResolvedGeoEntity['role'],
  kind: GeoEntityKind,
  place: Partial<ResolvedGeoEntity>,
): ResolvedGeoEntity => ({
  hintKey,
  hintName: hintKey,
  provider: 'openstreetmap',
  externalId: `osm:${hintKey}`,
  geoEntityId: `geo-${hintKey}`,
  role,
  kind,
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' },
  status: 'resolved',
  ...place,
});

const unresolvedEntity = (
  hintKey: string,
  role: ResolvedGeoEntity['role'],
  reason: string,
): ResolvedGeoEntity => ({
  hintKey,
  hintName: hintKey,
  provider: 'openstreetmap',
  externalId: '',
  role,
  nameEvidenceMultiplicity: { exactName: 'UNKNOWN', declaredAlias: 'UNKNOWN' },
  status: 'unresolved',
  reason,
});

const audit = (
  hintKey: string,
  attempts: Partial<ResolutionAttemptAudit>[],
): ComponentResolutionAudit => ({
  hintKey,
  hintName: hintKey,
  role: 'waypoint',
  evidenceKeys: ['ev-1'],
  attempts: attempts.map(
    (attempt): ResolutionAttemptAudit => ({
      strategy: 'LOCAL_OSM_POOL',
      executionStatus: 'completed',
      candidateAcquired: false,
      identityEvidence: [],
      ...attempt,
    }),
  ),
  finalStatus: 'unresolved',
});

describe('buildCompositeComponentResolution (Stage 4)', () => {
  // Plaza de Mayo DESIGN fixture (Stage 1 Case C): a correctly resolved
  // point OUTSIDE San Telmo, connected into it by a Calle-Defensa-shaped
  // route. Not the observed RW1 acquisition failure.
  const plazaDeMayo = resolvedEntity(
    'plaza-de-mayo',
    'waypoint',
    GeoEntityKind.PLACE,
    { latitude: -34.6195, longitude: -58.3755 },
  );
  const calleDefensa = resolvedEntity(
    'calle-defensa',
    'route',
    GeoEntityKind.ROUTE,
    {
      latitude: -34.6195,
      longitude: -58.372,
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-58.3745, -34.6195],
            [-58.3715, -34.6195],
          ],
          [
            [-58.3715, -34.6195],
            [-58.3695, -34.6195],
          ],
        ],
      },
    },
  );
  const zanjon = resolvedEntity('el-zanjon', 'venue', GeoEntityKind.PLACE, {
    latitude: -34.6195,
    longitude: -58.3705,
  });

  it('Identity RESOLVED and Geography OUTSIDE are two distinct facts (Plaza de Mayo design fixture)', () => {
    const result = buildCompositeComponentResolution({
      candidate: candidate([hint('plaza-de-mayo', 'waypoint', 'PLACE')]),
      entities: [plazaDeMayo],
      componentAudits: [],
      validationScope: SAN_TELMO_SCOPE,
    });
    const [fact] = result.components;
    expect(fact.identityStatus).toBe('RESOLVED');
    expect(fact.deficit).toBeUndefined();
    expect(fact.resolved).toMatchObject({
      geoEntityId: 'geo-plaza-de-mayo',
      geoEntityKind: GeoEntityKind.PLACE,
      canonicalGeometry: 'POINT',
      geographicRelation: 'OUTSIDE',
    });
    // Measured, not classified as NEAR (no threshold chosen in Stage 4).
    expect(fact.resolved?.distanceToBoundaryMeters).toBeGreaterThan(0);
    expect(result.scope).toEqual({
      kind: 'VALIDATION_AREA',
      name: 'San Telmo',
    });
    expect(result.coverage).toMatchObject({
      identityResolvedComponents: 1,
      geographicallyAcceptedComponents: 0,
      sourceCompositionComplete: true,
    });
  });

  it('Calle Defensa (MultiLineString ROUTE) relates by real line/polygon intersection', () => {
    const result = buildCompositeComponentResolution({
      candidate: candidate([hint('calle-defensa', 'route', 'ROUTE')]),
      entities: [calleDefensa],
      componentAudits: [],
      validationScope: SAN_TELMO_SCOPE,
    });
    expect(result.components[0].resolved).toMatchObject({
      geoEntityKind: GeoEntityKind.ROUTE,
      canonicalGeometry: 'LINE',
      geographicRelation: 'INTERSECTS',
    });
  });

  it('a ROUTE whose representative point is inside but has no line geometry stays UNDETERMINED', () => {
    const result = buildCompositeComponentResolution({
      candidate: candidate([hint('calle-defensa', 'route', 'ROUTE')]),
      entities: [{ ...calleDefensa, geometry: undefined, longitude: -58.37 }],
      componentAudits: [],
      validationScope: SAN_TELMO_SCOPE,
    });
    expect(result.components[0].resolved).toMatchObject({
      canonicalGeometry: 'NONE',
      geographicRelation: 'UNDETERMINED',
    });
    expect(result.coverage.geographicallyAcceptedComponents).toBe(0);
  });

  it('Pasaje San Lorenzo: candidate acquired then not confirmed stays an explicit identity deficit, never OUTSIDE/optional/trimmed', () => {
    const result = buildCompositeComponentResolution({
      candidate: candidate(
        [
          hint('plaza-de-mayo', 'waypoint', 'PLACE'),
          hint('calle-defensa', 'route', 'ROUTE'),
          hint('pasaje-san-lorenzo', 'waypoint', 'ROUTE'),
          hint('el-zanjon', 'venue', 'PLACE'),
        ],
        true,
      ),
      entities: [
        plazaDeMayo,
        calleDefensa,
        unresolvedEntity('pasaje-san-lorenzo', 'waypoint', 'UNCONFIRMED_MATCH'),
        zanjon,
      ],
      componentAudits: [
        audit('pasaje-san-lorenzo', [
          { candidateAcquired: true, verificationDecision: 'REJECTED' },
        ]),
      ],
      validationScope: SAN_TELMO_SCOPE,
    });
    expect(
      result.components.map((fact) => [
        fact.hintKey,
        fact.sourceOrder,
        fact.identityStatus,
        fact.resolved?.geographicRelation ?? null,
        fact.deficit?.reason ?? null,
      ]),
    ).toEqual([
      ['plaza-de-mayo', 1, 'RESOLVED', 'OUTSIDE', null],
      ['calle-defensa', 2, 'RESOLVED', 'INTERSECTS', null],
      ['pasaje-san-lorenzo', 3, 'UNRESOLVED', null, 'CANDIDATE_UNCONFIRMED'],
      ['el-zanjon', 4, 'RESOLVED', 'INSIDE', null],
    ]);
    expect(result.components[2].deficit?.classification).toBe(
      'PENDING_CLASSIFICATION',
    );
    expect(result.coverage).toEqual({
      totalComponents: 4,
      identityResolvedComponents: 3,
      geographicallyAcceptedComponents: 2,
      unresolvedComponents: 1,
      ambiguousComponents: 0,
      conflictedComponents: 0,
      resolutionRatio: 3 / 4,
      openResearchDeficits: [],
      sourceCompositionComplete: false,
    });
  });

  it('AMBIGUOUS: competing candidates, no winner, no geographic fact, a genuine KNOWLEDGE_DEFICIT', () => {
    const result = buildCompositeComponentResolution({
      candidate: candidate([
        hint('el-zanjon', 'venue', 'PLACE'),
        hint('nuestra-senora-de-belen', 'venue', 'PLACE'),
      ]),
      entities: [
        zanjon,
        unresolvedEntity(
          'nuestra-senora-de-belen',
          'venue',
          'UNCONFIRMED_MATCH',
        ),
      ],
      componentAudits: [
        audit('nuestra-senora-de-belen', [
          { candidateAcquired: true, verificationDecision: 'AMBIGUOUS' },
        ]),
      ],
      validationScope: SAN_TELMO_SCOPE,
    });
    const belen = result.components[1];
    expect(belen.identityStatus).toBe('AMBIGUOUS');
    expect(belen.resolved).toBeUndefined();
    expect(belen.deficit).toEqual({
      reason: 'AMBIGUOUS_CANDIDATES',
      classification: 'KNOWLEDGE_DEFICIT',
    });
    expect(result.coverage).toMatchObject({
      ambiguousComponents: 1,
      openResearchDeficits: ['nuestra-senora-de-belen'],
      sourceCompositionComplete: false,
    });
  });

  it('keeps no-candidate, provider failure, identity conflict and destination gate distinct', () => {
    const result = buildCompositeComponentResolution({
      candidate: candidate([
        hint('nothing', 'waypoint', 'PLACE'),
        hint('provider-down', 'waypoint', 'PLACE'),
        hint('conflict', 'route', 'ROUTE'),
        hint('far-area', 'area', 'AREA'),
      ]),
      entities: [
        unresolvedEntity('nothing', 'waypoint', 'NO_OSM_MATCH'),
        unresolvedEntity('provider-down', 'waypoint', 'OSM_PROVIDER_FAILED'),
        unresolvedEntity('conflict', 'route', 'IDENTITY_CONFLICT'),
        unresolvedEntity('far-area', 'area', 'DESTINATION_INCOMPATIBLE'),
      ],
      componentAudits: [
        audit('nothing', [{}]),
        audit('provider-down', [{ executionStatus: 'failed' }]),
      ],
      validationScope: SAN_TELMO_SCOPE,
    });
    expect(
      result.components.map((fact) => [
        fact.identityStatus,
        fact.deficit?.reason,
        fact.deficit?.classification,
      ]),
    ).toEqual([
      ['UNRESOLVED', 'NO_CANDIDATE_ACQUIRED', 'PENDING_CLASSIFICATION'],
      ['UNRESOLVED', 'PROVIDER_FAILURE', 'OPERATIONAL_FAILURE'],
      ['CONFLICTED', 'IDENTITY_CONFLICT', 'PENDING_CLASSIFICATION'],
      ['UNRESOLVED', 'DESTINATION_INCOMPATIBLE', 'PENDING_CLASSIFICATION'],
    ]);
    // Only genuine knowledge ambiguity feeds research; none here.
    expect(result.coverage.openResearchDeficits).toEqual([]);
    expect(result.coverage.conflictedComponents).toBe(1);
  });

  it('array order is not a sequence: sourceOrder is null without evidenced order', () => {
    const result = buildCompositeComponentResolution({
      candidate: candidate([
        hint('plaza-de-mayo', 'waypoint', 'PLACE'),
        hint('el-zanjon', 'venue', 'PLACE'),
      ]),
      entities: [plazaDeMayo, zanjon],
      componentAudits: [],
      validationScope: SAN_TELMO_SCOPE,
    });
    expect(result.components.map((fact) => fact.sourceOrder)).toEqual([
      null,
      null,
    ]);
  });

  it('falls back to the destination boundary, then to a point radius, then to UNAVAILABLE', () => {
    const input = {
      candidate: candidate([hint('el-zanjon', 'venue', 'PLACE')]),
      entities: [zanjon],
      componentAudits: [] as ComponentResolutionAudit[],
    };
    const destination = buildCompositeComponentResolution({
      ...input,
      geographicScope: {
        kind: 'AREA_BOUNDARY',
        boundary: { name: 'San Telmo', geometry: SAN_TELMO } as any,
      },
    });
    expect(destination.scope).toEqual({
      kind: 'DESTINATION_AREA',
      name: 'San Telmo',
    });
    expect(destination.components[0].resolved?.geographicRelation).toBe(
      'INSIDE',
    );

    const radius = buildCompositeComponentResolution({
      ...input,
      geographicScope: {
        kind: 'POINT_RADIUS',
        latitude: -34.6195,
        longitude: -58.3705,
        radiusMeters: 50,
      },
    });
    expect(radius.scope).toEqual({ kind: 'POINT_RADIUS', radiusMeters: 50 });
    expect(radius.components[0].resolved?.geographicRelation).toBe('INSIDE');

    const unavailable = buildCompositeComponentResolution(input);
    expect(unavailable.scope).toEqual({ kind: 'UNAVAILABLE' });
    expect(unavailable.components[0].resolved?.geographicRelation).toBe(
      'UNDETERMINED',
    );
  });
});
