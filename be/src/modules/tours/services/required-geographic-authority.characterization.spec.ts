import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { evaluateAreaScopeMembership } from '../utils/area-scope-membership-policy';
import {
  buildExperienceFootprint,
  buildOrderedComponentFootprints,
} from '../utils/spatial-footprint.util';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

/**
 * Stage 4 characterization lock (component-resolution-and-partial-
 * composite-recovery-plan.md). Freezes, BEFORE the cutover, every place
 * where a `required` value (persisted `ExperienceComponent.required`,
 * `AreaScopeComponentFact.required`, or the Stage-2 migration seam
 * `isMigrationRequiredHint`) still acts as geographic / reuse / planner
 * authority. Each case holds the structural facts constant and varies only
 * `required`, so the later cutover commit can flip exactly these
 * expectations and nothing else.
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

// Enters San Telmo from the west, like Defensa coming from Plaza de Mayo.
const DEFENSA_LINE: GeoJsonGeometry = {
  type: 'LineString',
  coordinates: [
    [-58.3745, -34.6195],
    [-58.3695, -34.6195],
  ],
};

// The same real street as a multi-way OSM entity (Stage 3 ROUTE cutover
// persists multi-way streets as MultiLineString).
const DEFENSA_MULTILINE: GeoJsonGeometry = {
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
};

describe('Stage 4 characterization: `required` as geographic authority (pre-cutover)', () => {
  describe('area-scope membership policy', () => {
    it('ignores a required:false route that genuinely intersects the area', () => {
      const route = { role: 'route', geometry: DEFENSA_LINE };
      const asRequired = evaluateAreaScopeMembership(
        SAN_TELMO,
        [{ ...route, required: true }],
        'AREA_ANCHORED_ROUTE',
      );
      const asOptional = evaluateAreaScopeMembership(
        SAN_TELMO,
        [{ ...route, required: false }],
        'AREA_ANCHORED_ROUTE',
      );
      expect(asRequired.passes).toBe(true);
      expect(asRequired.routeIntersectsArea).toBe(true);
      // Same geometry, only the flag differs: the route disappears.
      expect(asOptional.passes).toBe(false);
      expect(asOptional.routeIntersectsArea).toBe(false);
    });

    it('does not recognize a MultiLineString route geometry at all', () => {
      const decision = evaluateAreaScopeMembership(
        SAN_TELMO,
        [{ required: true, role: 'route', geometry: DEFENSA_MULTILINE }],
        'AREA_ANCHORED_ROUTE',
      );
      expect(decision.routeIntersectsArea).toBe(false);
      expect(decision.passes).toBe(false);
    });
  });

  describe('planner spatial footprint', () => {
    const components = (secondRequired: boolean) => [
      {
        required: true,
        order: 1,
        role: 'waypoint',
        geoEntity: { latitude: -34.62, longitude: -58.372 },
      },
      {
        required: secondRequired,
        order: 2,
        role: 'waypoint',
        geoEntity: { latitude: -34.618, longitude: -58.369 },
      },
    ];

    it('drops a persisted required:false component from the planner footprint', () => {
      expect(buildOrderedComponentFootprints(components(true))).toHaveLength(2);
      expect(buildOrderedComponentFootprints(components(false))).toHaveLength(
        1,
      );
      expect(
        buildExperienceFootprint({ components: components(true) }).type,
      ).toBe('AREA');
      expect(
        buildExperienceFootprint({ components: components(false) }).type,
      ).toBe('POINT');
    });
  });

  describe('catalog warm reuse', () => {
    const row = (routeRequired: boolean): any => ({
      id: 'exp-walk',
      canonicalName: 'San Telmo Walk',
      description: null,
      price: null,
      qualityScore: null,
      latitude: null,
      longitude: null,
      durationMinutes: null,
      openingHours: null,
      metadata: {},
      traits: [],
      components: [
        {
          geoEntityId: 'geo-plaza-de-mayo',
          role: 'waypoint',
          required: true,
          // Outside San Telmo.
          geoEntity: {
            kind: GeoEntityKind.PLACE,
            latitude: -34.6083,
            longitude: -58.3712,
            geometry: null,
          },
        },
        {
          geoEntityId: 'geo-defensa',
          role: 'route',
          required: routeRequired,
          geoEntity: {
            kind: GeoEntityKind.ROUTE,
            latitude: -34.6195,
            longitude: -58.372,
            geometry: DEFENSA_LINE,
          },
        },
      ],
    });
    const serviceFor = (routeRequired: boolean) => {
      const prisma: any = {
        geoEntity: {
          findUnique: jest.fn().mockResolvedValue({
            kind: GeoEntityKind.AREA,
            geometry: SAN_TELMO,
          }),
        },
        experience: {
          findMany: jest.fn().mockResolvedValue([row(routeRequired)]),
        },
      };
      return {
        service: new ExperienceCatalogService(prisma, {} as any),
        prisma,
      };
    };

    it('findVerifiedMultiComponentInArea: a persisted required:false route no longer anchors the Experience', async () => {
      const required = await serviceFor(
        true,
      ).service.findVerifiedMultiComponentInArea('area', 'AREA_ANCHORED_ROUTE');
      const optional = await serviceFor(
        false,
      ).service.findVerifiedMultiComponentInArea('area', 'AREA_ANCHORED_ROUTE');
      expect(required.map((item) => item.id)).toEqual(['exp-walk']);
      expect(optional).toEqual([]);
    });

    it('findVerifiedMultiComponentByExactComponent: filters by required:true on the matching component', async () => {
      const { service, prisma } = serviceFor(true);
      prisma.experience.findMany = jest.fn().mockResolvedValue([]);
      await service.findVerifiedMultiComponentByExactComponent('geo-defensa');
      expect(prisma.experience.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            components: {
              some: { geoEntityId: 'geo-defensa', required: true },
            },
          }),
        }),
      );
    });
  });

  describe('resolver whole-candidate gate', () => {
    const boundary: any = {
      id: 'osm:relation:1',
      name: 'Buenos Aires',
      osmType: 'relation',
      osmId: 1,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.55, -34.7],
            [-58.3, -34.7],
            [-58.3, -34.45],
            [-58.55, -34.45],
            [-58.55, -34.7],
          ],
        ],
      },
      tags: { boundary: 'administrative' },
    };
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const sixStopWalk: ExperienceCandidate = {
      name: 'Six Stop Walk',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      orderedByEvidence: true,
      componentHints: letters.map((letter) => ({
        key: `stop-${letter}`,
        name: `Stop ${letter}`,
        role: 'waypoint' as const,
        expectedKind: 'PLACE' as const,
        evidenceKeys: ['ev-1'],
      })),
      evidenceKeys: ['ev-1'],
      shortReason: 'A six-stop evidenced walk',
    };
    // Only A, B, D and F exist in the local OSM pool: C and E stay
    // genuinely unresolved (no candidate acquired).
    const pool = ['A', 'B', 'D', 'F'].map((letter, index) => ({
      id: `osm:node:${index + 1}`,
      name: `Stop ${letter}`,
      osmType: 'node',
      osmId: index + 1,
      geometry: {
        type: 'Point',
        coordinates: [-58.372 + index * 0.0005, -34.62 + index * 0.0005],
      },
      tags: {},
    }));

    it('rejects the whole candidate as UNRESOLVED_REQUIRED_COMPONENT before geography and never persists it', async () => {
      let upserts = 0;
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        findGeoEntityCandidatesForHint: jest
          .fn()
          .mockResolvedValue({ candidates: [] }),
        upsertGeoEntity: jest.fn().mockImplementation(async () => {
          upserts += 1;
          return { id: `geo-${upserts}` };
        }),
        rememberVerifiedHintName: jest.fn().mockResolvedValue('REMEMBERED'),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const validateSpy = jest.spyOn(geographicValidator, 'validate');
      const service = new ExperienceProposalResolverService(
        {
          lookupPoisWithin: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: pool }),
        } as any,
        catalog as any,
        geographicValidator,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [sixStopWalk],
      });

      expect(result.resolved[0].status).toBe('rejected');
      expect(result.resolved[0].rejectionReasons).toEqual([
        'UNRESOLVED_REQUIRED_COMPONENT',
      ]);
      // A, B, D, F were resolved (GeoEntities upserted) ...
      expect(
        result.resolved[0].resolvedEntities
          .filter((entity) => entity.status === 'resolved')
          .map((entity) => entity.hintKey),
      ).toEqual(['stop-A', 'stop-B', 'stop-D', 'stop-F']);
      // ... but no geographic fact is ever computed for them, and every
      // component audit is labeled with the migration seam's `required`.
      expect(validateSpy).not.toHaveBeenCalled();
      expect(
        result.entityResolution?.forensicAudit[0].componentAudits.map(
          (audit) => (audit as any).required,
        ),
      ).toEqual([true, true, true, true, true, true]);
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });
  });
});
