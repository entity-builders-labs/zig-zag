import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { AreaScopeComponentFact } from '../interfaces/area-scope-membership.interface';
import { evaluateAreaScopeMembership } from '../utils/area-scope-membership-policy';
import {
  buildExperienceFootprint,
  buildOrderedComponentFootprints,
} from '../utils/spatial-footprint.util';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

/**
 * Stage 4 cutover (component-resolution-and-partial-composite-recovery-
 * plan.md). Commit f4d4f81 froze every place where a `required` value acted
 * as geographic / warm-reuse / planner authority; this spec keeps the SAME
 * structural fixtures and proves the flag no longer changes any decision.
 * Each mutation case varies only `required` (smuggled in as an extra
 * property where the typed contract no longer has it) and asserts identical
 * relations, footprints, reuse results and coverage.
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

const withRequired = <T extends object>(value: T, required: boolean): T =>
  ({ ...value, required }) as T;

describe('Stage 4: `required` carries no geographic authority', () => {
  describe('area-scope membership policy', () => {
    it('a route intersecting the area is evaluated identically whatever `required` says', () => {
      const route: AreaScopeComponentFact = {
        hintKey: 'defensa',
        role: 'route',
        kind: GeoEntityKind.ROUTE,
        geometry: DEFENSA_LINE,
      };
      const asRequired = evaluateAreaScopeMembership(
        SAN_TELMO,
        [withRequired(route, true)],
        'AREA_ANCHORED_ROUTE',
      );
      const asOptional = evaluateAreaScopeMembership(
        SAN_TELMO,
        [withRequired(route, false)],
        'AREA_ANCHORED_ROUTE',
      );
      expect(asOptional).toEqual(asRequired);
      expect(asRequired.passes).toBe(true);
      expect(asRequired.routeIntersectsArea).toBe(true);
      expect(asRequired.components).toEqual([
        {
          hintKey: 'defensa',
          role: 'route',
          basis: 'LINE',
          relation: 'INTERSECTS',
        },
      ]);
    });

    it('Calle Defensa as a MultiLineString goes through the same line/polygon intersection', () => {
      const decision = evaluateAreaScopeMembership(
        SAN_TELMO,
        [
          {
            role: 'route',
            kind: GeoEntityKind.ROUTE,
            geometry: DEFENSA_MULTILINE,
          },
        ],
        'AREA_ANCHORED_ROUTE',
      );
      expect(decision.routeIntersectsArea).toBe(true);
      expect(decision.passes).toBe(true);
      expect(decision.components[0]).toMatchObject({
        basis: 'LINE',
        relation: 'INTERSECTS',
      });
    });
  });

  describe('planner spatial footprint', () => {
    const components = (secondRequired: boolean) => [
      {
        order: 1,
        role: 'waypoint',
        geoEntity: { latitude: -34.62, longitude: -58.372 },
      },
      withRequired(
        {
          order: 2,
          role: 'waypoint',
          geoEntity: { latitude: -34.618, longitude: -58.369 },
        },
        secondRequired,
      ),
    ];

    it('every persisted component shapes the footprint regardless of `required`', () => {
      expect(buildOrderedComponentFootprints(components(false))).toEqual(
        buildOrderedComponentFootprints(components(true)),
      );
      expect(buildOrderedComponentFootprints(components(false))).toHaveLength(
        2,
      );
      expect(
        buildExperienceFootprint({ components: components(false) }),
      ).toEqual(buildExperienceFootprint({ components: components(true) }));
      expect(
        buildExperienceFootprint({ components: components(false) }).type,
      ).toBe('AREA');
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

    it('findVerifiedMultiComponentInArea: the persisted route anchors the Experience whatever `required` says', async () => {
      const required = await serviceFor(
        true,
      ).service.findVerifiedMultiComponentInArea('area', 'AREA_ANCHORED_ROUTE');
      const optional = await serviceFor(
        false,
      ).service.findVerifiedMultiComponentInArea('area', 'AREA_ANCHORED_ROUTE');
      expect(required.map((item) => item.id)).toEqual(['exp-walk']);
      expect(optional.map((item) => item.id)).toEqual(['exp-walk']);
    });

    it('findVerifiedMultiComponentByExactComponent: matches any persisted component, no `required` filter', async () => {
      const { service, prisma } = serviceFor(true);
      prisma.experience.findMany = jest.fn().mockResolvedValue([]);
      await service.findVerifiedMultiComponentByExactComponent('geo-defensa');
      expect(prisma.experience.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            components: { some: { geoEntityId: 'geo-defensa' } },
          }),
        }),
      );
    });
  });

  describe('resolver: A-B-C-D-E-F with C and E unresolved', () => {
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
    const sixStopWalk = (smuggledRequired?: boolean): ExperienceCandidate => ({
      name: 'Six Stop Walk',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      orderedByEvidence: true,
      componentHints: letters.map((letter) => {
        const hint = {
          key: `stop-${letter}`,
          name: `Stop ${letter}`,
          role: 'waypoint' as const,
          expectedKind: 'PLACE' as const,
          evidenceKeys: ['ev-1'],
        };
        return smuggledRequired === undefined
          ? hint
          : withRequired(
              hint,
              letter === 'C' || letter === 'E' ? smuggledRequired : true,
            );
      }),
      evidenceKeys: ['ev-1'],
      shortReason: 'A six-stop evidenced walk',
    });
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

    const run = async (candidate: ExperienceCandidate) => {
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
        candidates: [candidate],
      });
      return { result, catalog, validateSpy };
    };

    it('keeps C and E as explicit identity deficits, gives A/B/D/F geographic facts, and never persists a trimmed A-B-D-F', async () => {
      const { result, catalog, validateSpy } = await run(sixStopWalk());
      const resolved = result.resolved[0];

      expect(resolved.status).toBe('rejected');
      expect(resolved.rejectionReasons).toEqual([
        'INCOMPLETE_SOURCE_COMPOSITION',
      ]);
      // Composite coherence never runs on a subset, and nothing persists.
      expect(validateSpy).not.toHaveBeenCalled();
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();

      const facts = resolved.componentResolution!.components;
      expect(
        facts.map((fact) => [
          fact.hintKey,
          fact.sourceOrder,
          fact.identityStatus,
          fact.resolved?.geographicRelation ?? null,
        ]),
      ).toEqual([
        ['stop-A', 1, 'RESOLVED', 'INSIDE'],
        ['stop-B', 2, 'RESOLVED', 'INSIDE'],
        ['stop-C', 3, 'UNRESOLVED', null],
        ['stop-D', 4, 'RESOLVED', 'INSIDE'],
        ['stop-E', 5, 'UNRESOLVED', null],
        ['stop-F', 6, 'RESOLVED', 'INSIDE'],
      ]);
      // Unresolved != geographic failure: no fake relation, no geoEntity.
      for (const key of ['stop-C', 'stop-E']) {
        const fact = facts.find((item) => item.hintKey === key)!;
        expect(fact.resolved).toBeUndefined();
        expect(fact.deficit).toEqual({
          reason: 'NO_CANDIDATE_ACQUIRED',
          classification: 'PENDING_CLASSIFICATION',
        });
      }
      expect(facts[0].resolved).toMatchObject({
        geoEntityId: 'geo-1',
        geoEntityKind: GeoEntityKind.PLACE,
        canonicalGeometry: 'POINT',
      });
      expect(resolved.componentResolution!.scope).toEqual({
        kind: 'DESTINATION_AREA',
        name: 'Buenos Aires',
      });
      expect(resolved.componentResolution!.coverage).toEqual({
        totalComponents: 6,
        identityResolvedComponents: 4,
        geographicallyAcceptedComponents: 4,
        unresolvedComponents: 2,
        ambiguousComponents: 0,
        conflictedComponents: 0,
        resolutionRatio: 4 / 6,
        openResearchDeficits: [],
        sourceCompositionComplete: false,
      });
      // The forensic audit carries the same facts, and no `required`.
      const audit = result.entityResolution!.forensicAudit[0];
      expect(audit.componentResolution).toEqual(resolved.componentResolution);
      expect(
        audit.componentAudits.every((component) => !('required' in component)),
      ).toBe(true);
    });

    it('a smuggled `required:false` on C/E changes nothing: same identity, geography and coverage', async () => {
      const baseline = (await run(sixStopWalk())).result.resolved[0];
      const optional = (await run(sixStopWalk(false))).result.resolved[0];
      const required = (await run(sixStopWalk(true))).result.resolved[0];
      for (const variant of [optional, required]) {
        expect(variant.status).toBe(baseline.status);
        expect(variant.rejectionReasons).toEqual(baseline.rejectionReasons);
        expect(variant.componentResolution).toEqual(
          baseline.componentResolution,
        );
      }
    });
  });
});
