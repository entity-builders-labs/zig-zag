import { GeoEntityKind } from '@prisma/client';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { ExperienceAcquisitionService } from 'src/modules/tours/services/experience-acquisition.service';
import { ExperienceAcquisitionPlannerService } from 'src/modules/tours/services/experience-acquisition-planner.service';
import { AreaRouteAnchorResolverService } from 'src/modules/tours/services/area-route-anchor-resolver.service';
import { AreaRouteWalkAcquisitionService } from 'src/modules/tours/services/area-route-walk-acquisition.service';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from 'src/modules/tours/services/experience-classification.service';
import { ExperienceCandidate } from 'src/modules/tours/interfaces/experience-discovery.interface';
import { PreferenceFacetDeficit } from 'src/modules/tours/interfaces/experience-acquisition-plan.interface';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Task B5 — real vertical integration coverage for the geographic
 * materialization correctness fixes: the external `validationScope`
 * pre-persistence gate, `findVerifiedMultiComponentCoveredByArea`'s real
 * PostGIS `ST_Covers` query, required/optional persistence, and
 * `AreaRouteWalkAcquisitionService`'s end-to-end tourism-route reuse-first
 * convergence. Real `ExperienceProposalResolverService`,
 * `CompositeGeographicValidationService`, `ExperienceCatalogService`,
 * Postgres/PostGIS — only external transports (OSM/Nominatim/Places) and
 * the LLM classifier are mocked. Never Tavily/SerpApi; no real web
 * discovery is needed for any case here.
 */

const SAN_TELMO_BOUNDARY = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-58.38, -34.63],
      [-58.36, -34.63],
      [-58.36, -34.61],
      [-58.38, -34.61],
      [-58.38, -34.63],
    ],
  ],
};

const BUENOS_AIRES_BOUNDARY: any = {
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
  tags: {},
};

function emptyOsmPlaces() {
  return {
    lookupStreetsWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupStreetsNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupBoundaryById: jest.fn(),
  };
}

describe('tour-generation integration · area/route walk geographic validation (Task B5)', () => {
  let catalog: ExperienceCatalogService;

  beforeAll(async () => {
    const prisma = await getPrisma();
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('findVerifiedMultiComponentInArea (canonical policy)', () => {
    async function seedArea() {
      const prisma = await getPrisma();
      return prisma.geoEntity.create({
        data: {
          name: 'San Telmo',
          kind: GeoEntityKind.AREA,
          geometry: SAN_TELMO_BOUNDARY as any,
        },
      });
    }

    async function seedMultiComponentExperience(
      pointsInside: Array<{ name: string; required: boolean }>,
      pointsOutside: Array<{ name: string; required: boolean }> = [],
    ) {
      const prisma = await getPrisma();
      const components: Array<{
        geoEntityId: string;
        role: string;
        required: boolean;
        order: number | null;
      }> = [];
      let order = 0;
      for (const point of pointsInside) {
        const geo = await prisma.geoEntity.create({
          data: {
            name: point.name,
            kind: GeoEntityKind.PLACE,
            latitude: -34.62,
            longitude: -58.37,
          },
        });
        components.push({
          geoEntityId: geo.id,
          role: 'venue',
          required: point.required,
          order: order++,
        });
      }
      for (const point of pointsOutside) {
        const geo = await prisma.geoEntity.create({
          data: {
            name: point.name,
            kind: GeoEntityKind.PLACE,
            latitude: -34.58,
            longitude: -58.4,
          },
        });
        components.push({
          geoEntityId: geo.id,
          role: 'venue',
          required: point.required,
          order: order++,
        });
      }
      return prisma.experience.create({
        data: {
          canonicalName: `Experience with ${components.length} components`,
          status: 'VERIFIED',
          metadata: {},
          components: { create: components },
        },
      });
    }

    it('finds a multi-component Experience whose required components are ALL covered by the area', async () => {
      const area = await seedArea();
      const experience = await seedMultiComponentExperience([
        { name: 'Plaza Dorrego', required: true },
        { name: 'Mercado de San Telmo', required: true },
      ]);

      const result = await catalog.findVerifiedMultiComponentInArea(
        area.id,
        'AREA_CONTAINED',
      );

      expect(result.map((r) => r.id)).toContain(experience.id);
    });

    it('excludes an Experience with a required component OUTSIDE the area', async () => {
      const area = await seedArea();
      const experience = await seedMultiComponentExperience(
        [{ name: 'Plaza Dorrego', required: true }],
        [{ name: 'MALBA', required: true }],
      );

      const result = await catalog.findVerifiedMultiComponentInArea(
        area.id,
        'AREA_CONTAINED',
      );

      expect(result.map((r) => r.id)).not.toContain(experience.id);
    });

    it('does NOT match an Experience whose OPTIONAL component is outside the area (only required components are checked)', async () => {
      const area = await seedArea();
      const experience = await seedMultiComponentExperience(
        [
          { name: 'Plaza Dorrego', required: true },
          { name: 'Mercado de San Telmo', required: true },
        ],
        [{ name: 'Rooftop Viewpoint', required: false }],
      );

      const result = await catalog.findVerifiedMultiComponentInArea(
        area.id,
        'AREA_CONTAINED',
      );

      expect(result.map((r) => r.id)).toContain(experience.id);
    });

    it('excludes an Experience with ZERO required components (vacuous-truth guard)', async () => {
      const area = await seedArea();
      const experience = await seedMultiComponentExperience([
        { name: 'Plaza Dorrego', required: false },
        { name: 'Mercado de San Telmo', required: false },
      ]);

      const result = await catalog.findVerifiedMultiComponentInArea(
        area.id,
        'AREA_CONTAINED',
      );

      expect(result.map((r) => r.id)).not.toContain(experience.id);
    });

    it('excludes a single-component Experience (not a real multi-component Experience)', async () => {
      const area = await seedArea();
      const prisma = await getPrisma();
      const geo = await prisma.geoEntity.create({
        data: {
          name: 'Plaza Dorrego',
          kind: GeoEntityKind.PLACE,
          latitude: -34.62,
          longitude: -58.37,
        },
      });
      const experience = await prisma.experience.create({
        data: {
          canonicalName: 'Single-stop visit',
          status: 'VERIFIED',
          metadata: {},
          components: {
            create: [
              { geoEntityId: geo.id, role: 'venue', required: true, order: 0 },
            ],
          },
        },
      });

      const result = await catalog.findVerifiedMultiComponentInArea(
        area.id,
        'AREA_CONTAINED',
      );

      expect(result.map((r) => r.id)).not.toContain(experience.id);
    });

    it('returns [] for a GeoEntity that is not kind=AREA', async () => {
      const prisma = await getPrisma();
      const notAnArea = await prisma.geoEntity.create({
        data: {
          name: 'A place',
          kind: GeoEntityKind.PLACE,
          latitude: -34.62,
          longitude: -58.37,
        },
      });
      await seedMultiComponentExperience([
        { name: 'Plaza Dorrego', required: true },
        { name: 'Mercado de San Telmo', required: true },
      ]);

      const result = await catalog.findVerifiedMultiComponentInArea(
        notAnArea.id,
        'AREA_CONTAINED',
      );

      expect(result).toEqual([]);
    });
  });

  describe('external validationScope pre-persistence gate (L, M — real resolver + validator + catalog)', () => {
    function unscopedCandidate(
      componentHints: ExperienceCandidate['componentHints'],
    ): ExperienceCandidate {
      return {
        name: 'San Telmo Historical Walk',
        themes: ['culture'],
        traits: [],
        intents: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints,
      };
    }

    it('L: rejects BEFORE persistence when a required component genuinely RESOLVES outside the external AREA scope, even with NO AREA hint on the candidate', async () => {
      // MALBA must actually resolve to a real, persisted GeoEntity with
      // real coordinates outside San Telmo -- rejection must happen
      // because that real point lies outside the polygon
      // (external_scope_mismatch), never because MALBA failed to resolve
      // at all (unresolved_required_component would be a different,
      // weaker regression).
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Plaza Dorrego',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'MALBA',
              osmType: 'node',
              osmId: 2,
              // Genuinely outside the San Telmo polygon (real Palermo-area
              // coordinates), inside Buenos Aires.
              geometry: { type: 'Point', coordinates: [-58.4, -34.58] },
              tags: {},
            },
          ],
        }),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'p2',
          name: 'MALBA',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ]);

      const result = await resolver.resolve({
        geographicScope: {
          kind: 'AREA_BOUNDARY' as const,
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [candidate],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
        validationScope: {
          kind: 'AREA',
          anchorName: 'San Telmo',
          geoEntityId: 'geo-san-telmo',
          geometry: SAN_TELMO_BOUNDARY,
        },
      } as any);

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].rejectionReasons).toContain(
        'external_scope_mismatch',
      );
      const prisma = await getPrisma();
      const persistedCount = await prisma.experience.count({
        where: { canonicalName: candidate.name },
      });
      expect(persistedCount).toBe(0);
    });

    it('M: accepts + persists when every required component (no AREA hint on the candidate) is genuinely inside the external AREA scope', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Plaza Dorrego',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Mercado de San Telmo',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.372, -34.62] },
              tags: {},
            },
          ],
        }),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );
      const candidate = unscopedCandidate([
        {
          key: 'p1',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'p2',
          name: 'Mercado de San Telmo',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ]);

      const result = await resolver.resolve({
        geographicScope: {
          kind: 'AREA_BOUNDARY' as const,
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [candidate],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
        validationScope: {
          kind: 'AREA',
          anchorName: 'San Telmo',
          geoEntityId: 'geo-san-telmo',
          geometry: SAN_TELMO_BOUNDARY,
        },
      } as any);

      expect(result.acceptedCount).toBe(1);
      const experienceId = result.resolved.find(
        (r) => r.status === 'accepted',
      )?.experienceId;
      expect(experienceId).toBeDefined();
      const prisma = await getPrisma();
      const persisted = await prisma.experience.findUnique({
        where: { id: experienceId },
      });
      expect(persisted).not.toBeNull();
    });
  });

  describe('required/optional persistence via the real resolver + catalog (I, I2)', () => {
    it('I: persists required:[true,true,false] for 2 required + 1 optional hint, all inside a real AREA', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Plaza Dorrego',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Mercado de San Telmo',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.372, -34.62] },
              tags: {},
            },
            {
              id: 'osm:node:3',
              name: 'Rooftop Viewpoint',
              osmType: 'node',
              osmId: 3,
              geometry: { type: 'Point', coordinates: [-58.373, -34.622] },
              tags: {},
            },
          ],
        }),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );
      const candidate: ExperienceCandidate = {
        name: 'San Telmo Historical Walk',
        themes: ['culture'],
        traits: [],
        intents: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'p1',
            name: 'Plaza Dorrego',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'p2',
            name: 'Mercado de San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'p3',
            name: 'Rooftop Viewpoint',
            role: 'venue',
            expectedKind: 'PLACE',
            required: false,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = await resolver.resolve({
        geographicScope: {
          kind: 'AREA_BOUNDARY' as const,
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [candidate],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
      });

      expect(result.acceptedCount).toBe(1);
      const experienceId = result.resolved[0].experienceId!;
      const prisma = await getPrisma();
      const persisted = await prisma.experience.findUnique({
        where: { id: experienceId },
        include: { components: true },
      });
      const requiredFlags = persisted!.components.map((c) => c.required).sort();
      expect(requiredFlags).toEqual([false, true, true]);
    });
  });

  describe('C2: multi-area ordinary-path via the real resolver (2 required AREA hints, no external validationScope)', () => {
    const LA_BOCA_BOUNDARY = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-58.37, -34.64],
          [-58.355, -34.64],
          [-58.355, -34.63],
          [-58.37, -34.63],
          [-58.37, -34.64],
        ],
      ],
    };

    it('accepts a candidate with 2 required AREA hints (San Telmo + La Boca) via the multi-area path, never forced into one area', async () => {
      // Both AREA-role hints resolve via the real Nominatim + lookupBoundaryById
      // fallback path (`resolveTrustedGlobalHint`), which requires
      // destinationAssociationVerified evidence -- since neither area hint's
      // name matches the single passed destination scope ("Buenos Aires")
      // by name, this is the ONLY real path that can resolve them.
      const nominatim = {
        search: jest.fn().mockImplementation(async (query: string) => {
          if (query === 'San Telmo') {
            return [
              {
                osmType: 'relation',
                osmId: 101,
                addresstype: 'suburb',
                class: 'place',
                type: 'suburb',
                placeRank: 20,
                displayName: 'San Telmo, Buenos Aires, Argentina',
                importance: 0.3,
                latitude: -34.62,
                longitude: -58.37,
              },
            ];
          }
          if (query === 'La Boca') {
            return [
              {
                osmType: 'relation',
                osmId: 102,
                addresstype: 'suburb',
                class: 'place',
                type: 'suburb',
                placeRank: 20,
                displayName: 'La Boca, Buenos Aires, Argentina',
                importance: 0.3,
                latitude: -34.635,
                longitude: -58.363,
              },
            ];
          }
          return [];
        }),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Plaza Dorrego',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Caminito',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.363, -34.636] },
              tags: {},
            },
          ],
        }),
        lookupBoundaryById: jest
          .fn()
          .mockImplementation(async (osmType: string, osmId: number) => ({
            status: 'success',
            value:
              osmId === 101
                ? {
                    id: 'osm:relation:101',
                    name: 'San Telmo',
                    osmType: 'relation',
                    osmId: 101,
                    geometry: SAN_TELMO_BOUNDARY,
                    tags: {},
                  }
                : {
                    id: 'osm:relation:102',
                    name: 'La Boca',
                    osmType: 'relation',
                    osmId: 102,
                    geometry: LA_BOCA_BOUNDARY,
                    tags: {},
                  },
          })),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
        undefined,
        nominatim as any,
      );
      const candidate: ExperienceCandidate = {
        name: 'Buenos Aires South Walk',
        themes: ['culture'],
        traits: [],
        intents: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'a1',
            name: 'San Telmo',
            role: 'area',
            expectedKind: 'AREA',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'a2',
            name: 'La Boca',
            role: 'area',
            expectedKind: 'AREA',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'w1',
            name: 'Plaza Dorrego',
            role: 'waypoint',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'w2',
            name: 'Caminito',
            role: 'waypoint',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = await resolver.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: {
          kind: 'AREA_BOUNDARY' as const,
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [candidate],
        evidence: [
          {
            key: 'ev-1',
            source: 'test',
            title: 'A walk through Buenos Aires',
            snippet: 'Crossing San Telmo and La Boca',
          },
        ],
      });

      expect(result.acceptedCount).toBe(1);
      expect(result.geographicValidation.results[0].strategy).toBe(
        'component_defined',
      );
      const experienceId = result.resolved.find(
        (r) => r.status === 'accepted',
      )?.experienceId;
      const prisma = await getPrisma();
      const persisted = await prisma.experience.findUnique({
        where: { id: experienceId },
      });
      expect(persisted).not.toBeNull();
    });
  });

  describe('D/E: canonical ROUTE coherent/incoherent via the real resolver', () => {
    const caminitoStreet = {
      id: 'osm:way:1',
      name: 'Caminito',
      osmType: 'way' as const,
      osmId: 1,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-58.3634, -34.6382],
          [-58.363, -34.6376],
        ],
      },
      tags: { highway: 'pedestrian' },
    };

    function routeCandidate(): ExperienceCandidate {
      return {
        name: 'Caminito Route',
        themes: [],
        traits: [],
        intents: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'r',
            name: 'Caminito',
            role: 'route',
            expectedKind: 'ROUTE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'w',
            name: 'Fundación Proa',
            role: 'waypoint',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };
    }

    it('D: accepts + persists a canonical ROUTE candidate with a coherent required waypoint', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [caminitoStreet] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Fundación Proa',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.364, -34.639] },
              tags: {},
            },
          ],
        }),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );

      const result = await resolver.resolve({
        geographicScope: {
          kind: 'AREA_BOUNDARY',
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [routeCandidate()],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
      });

      expect(result.acceptedCount).toBe(1);
      expect(result.geographicValidation.results[0].strategy).toBe(
        'canonical_geometry',
      );
      const experienceId = result.resolved.find(
        (r) => r.status === 'accepted',
      )?.experienceId;
      const prisma = await getPrisma();
      const persisted = await prisma.experience.findUnique({
        where: { id: experienceId },
      });
      expect(persisted).not.toBeNull();
    });

    it('E: rejects a canonical ROUTE candidate whose required waypoint is geographically incoherent, nothing persisted', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [caminitoStreet] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Fundación Proa',
              osmType: 'node',
              osmId: 1,
              // A different country entirely -- fails the ROUTE branch's
              // own destination/coherence check.
              geometry: { type: 'Point', coordinates: [10, 10] },
              tags: {},
            },
          ],
        }),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );

      const result = await resolver.resolve({
        geographicScope: {
          kind: 'AREA_BOUNDARY',
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [routeCandidate()],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
      });

      expect(result.acceptedCount).toBe(0);
      const prisma = await getPrisma();
      const persistedCount = await prisma.experience.count({
        where: { canonicalName: 'Caminito Route' },
      });
      expect(persistedCount).toBe(0);
    });
  });

  describe('E2/O/P: route_like route-scale geography is driven ONLY by validationIntent, real resolver end-to-end', () => {
    function wineryCandidate(intents: string[]): ExperienceCandidate {
      return {
        name: 'Ruta del Vino',
        themes: [],
        traits: [],
        intents,
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'w1',
            name: 'Winery A',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'w2',
            name: 'Winery B',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };
    }

    // Spread wide enough (~77km apart, inside a wide destination boundary)
    // to fail the tight `experience`-scale thresholds but pass `route`-scale.
    const WIDE_BOUNDARY: any = {
      id: 'osm:relation:2',
      name: 'Wide region',
      osmType: 'relation',
      osmId: 2,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.6, -34.9],
            [-58.2, -34.9],
            [-58.2, -34.1],
            [-58.6, -34.1],
            [-58.6, -34.9],
          ],
        ],
      },
      tags: {},
    };

    function wineryOsmPlaces() {
      return {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Winery A',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.4, -34.15] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Winery B',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.4, -34.85] },
              tags: {},
            },
          ],
        }),
      };
    }

    it('E2/O: accepts under route-scale thresholds when validationIntent is route_like, even with no route component', async () => {
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        wineryOsmPlaces() as any,
        catalog,
        geographicValidator,
      );

      const result = await resolver.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary: WIDE_BOUNDARY },
        candidates: [wineryCandidate([])], // real B6 shape -- no intents on the candidate
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
        validationIntent: 'route_like',
      } as any);

      expect(result.acceptedCount).toBe(1);
    });

    it("P: a candidate declaring intents:['route_like'] itself CANNOT substitute for validationIntent -- ordinary (tighter) thresholds still apply and reject", async () => {
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        wineryOsmPlaces() as any,
        catalog,
        geographicValidator,
      );

      const result = await resolver.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary: WIDE_BOUNDARY },
        candidates: [wineryCandidate(['route_like'])], // candidate claims route_like...
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
        // ...but validationIntent is NOT passed -- must still reject.
      });

      expect(result.acceptedCount).toBe(0);
      const prisma = await getPrisma();
      const persistedCount = await prisma.experience.count({
        where: { canonicalName: 'Ruta del Vino' },
      });
      expect(persistedCount).toBe(0);
    });
  });

  describe('N1/N2: real LineString corridor via external ROUTE validationScope, real resolver end-to-end', () => {
    const CAMINITO_SCOPE_GEOMETRY = {
      type: 'LineString' as const,
      coordinates: [
        [-58.3634, -34.6382],
        [-58.363, -34.6376],
      ],
    };
    const routeValidationScope = {
      kind: 'ROUTE' as const,
      anchorName: 'Caminito',
      geoEntityId: 'geo-caminito',
      geometry: CAMINITO_SCOPE_GEOMETRY,
    };

    function unscopedVenueCandidate(
      name: string,
      point: [number, number],
    ): { candidate: ExperienceCandidate; osmPlaces: any } {
      const candidate: ExperienceCandidate = {
        name: 'Caminito Area Walk',
        themes: [],
        traits: [],
        intents: [],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'p1',
            name,
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name,
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: point },
              tags: {},
            },
          ],
        }),
      };
      return { candidate, osmPlaces };
    }

    it('N1: accepts + persists when the required component genuinely resolves near (on/adjacent to) the real LineString', async () => {
      const { candidate, osmPlaces } = unscopedVenueCandidate(
        'Fundación Proa',
        [-58.3632, -34.6379], // ~real proximity to the Caminito segment
      );
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );

      const result = await resolver.resolve({
        geographicScope: {
          kind: 'AREA_BOUNDARY',
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [candidate],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
        validationScope: routeValidationScope,
      } as any);

      expect(result.acceptedCount).toBe(1);
      const experienceId = result.resolved[0].experienceId!;
      const prisma = await getPrisma();
      expect(
        await prisma.experience.findUnique({ where: { id: experienceId } }),
      ).not.toBeNull();
    });

    it('N2: rejects (nothing persisted) when the required component resolves several km from the real LineString, even while still inside the broad destination boundary', async () => {
      const { candidate, osmPlaces } = unscopedVenueCandidate(
        'Far Stop',
        [-58.42, -34.6], // several km from Caminito, still inside Buenos Aires
      );
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );

      const result = await resolver.resolve({
        geographicScope: {
          kind: 'AREA_BOUNDARY',
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        candidates: [candidate],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
        validationScope: routeValidationScope,
      } as any);

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].rejectionReasons).toContain(
        'external_scope_mismatch',
      );
      const prisma = await getPrisma();
      const persistedCount = await prisma.experience.count({
        where: { canonicalName: 'Caminito Area Walk' },
      });
      expect(persistedCount).toBe(0);
    });
  });

  describe('Q: acceptedIds prevents an unrelated pre-existing matching Experience from leaking into the post-acquisition result', () => {
    it('returns the newly-acquired Experience, never a pre-existing unrelated one the area also covers', async () => {
      // A PRE-EXISTING, geographically-compatible-but-UNRELATED Experience
      // ("Food Crawl San Telmo") already sits inside the same area, seeded
      // directly against real Postgres before acquisition runs.
      const prisma = await getPrisma();
      const area = await prisma.geoEntity.create({
        data: {
          name: 'San Telmo',
          kind: GeoEntityKind.AREA,
          geometry: SAN_TELMO_BOUNDARY as any,
        },
      });
      const foodGeo1 = await prisma.geoEntity.create({
        data: {
          name: 'Food Stop A',
          kind: GeoEntityKind.PLACE,
          latitude: -34.621,
          longitude: -58.371,
        },
      });
      const foodGeo2 = await prisma.geoEntity.create({
        data: {
          name: 'Food Stop B',
          kind: GeoEntityKind.PLACE,
          latitude: -34.62,
          longitude: -58.372,
        },
      });
      await prisma.experience.create({
        data: {
          canonicalName: 'Food Crawl San Telmo',
          status: 'VERIFIED',
          metadata: {
            classification: {
              state: 'classified',
              promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
              modelId: 'groq/qwen',
              themes: [],
              intents: ['food'],
              traits: [],
              reasoningEvidence: [
                { facet: 'intent:food', evidenceKeys: ['x'], reason: 'r' },
              ],
            },
            intents: ['food'],
          },
          components: {
            create: [
              {
                geoEntityId: foodGeo1.id,
                role: 'venue',
                required: true,
                order: 0,
              },
              {
                geoEntityId: foodGeo2.id,
                role: 'venue',
                required: true,
                order: 1,
              },
            ],
          },
        },
      });

      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:10',
              name: 'Plaza Dorrego',
              osmType: 'node',
              osmId: 10,
              geometry: { type: 'Point', coordinates: [-58.3705, -34.6205] },
              tags: {},
            },
            {
              id: 'osm:node:11',
              name: 'Mercado de San Telmo',
              osmType: 'node',
              osmId: 11,
              geometry: { type: 'Point', coordinates: [-58.3715, -34.6215] },
              tags: {},
            },
          ],
        }),
        lookupBoundaryById: jest.fn(),
      };
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );
      const embeddingIndexer = {
        index: jest.fn().mockResolvedValue({ status: 'unavailable' }),
      };
      // Cutover M4: classification runs inside
      // ExperienceAcquisitionService.materializeExecution() now (the
      // shared canonical materialization boundary) -- the classifier is a
      // dependency of THAT service, not of AreaRouteWalkAcquisitionService.
      const classifier = { classify: jest.fn() };
      const acquisitionService = new ExperienceAcquisitionService(
        catalog,
        embeddingIndexer as any,
        undefined,
        undefined,
        undefined,
        undefined,
        resolver,
        undefined,
        undefined,
        undefined,
        classifier as any,
      );
      const acquisitionPlanner = new ExperienceAcquisitionPlannerService();
      const anchorResolver = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog,
      );
      anchorResolver.resolveArea = jest.fn().mockResolvedValue({
        resolved: true,
        geoEntityId: area.id,
        geometry: SAN_TELMO_BOUNDARY,
      });
      const service = new AreaRouteWalkAcquisitionService(
        anchorResolver,
        catalog,
        acquisitionPlanner,
        acquisitionService,
      );

      const walkCandidate: ExperienceCandidate = {
        name: 'San Telmo Historical Walk',
        themes: [],
        traits: [],
        intents: [],
        evidenceKeys: ['w1', 'w2'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'p1',
            name: 'Plaza Dorrego',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['w1'],
          },
          {
            key: 'p2',
            name: 'Mercado de San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['w2'],
          },
        ],
      };
      jest.spyOn(acquisitionService, 'executePlan').mockResolvedValue({
        candidates: [walkCandidate],
        observations: [],
        providerResults: {},
        evidence: [
          { key: 'w1', source: 'test', snippet: 's1' },
          { key: 'w2', source: 'test', snippet: 's2' },
        ],
      } as any);
      jest.spyOn(acquisitionPlanner, 'buildAcquisitionPlan').mockReturnValue({
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
        breadth: 'focused',
      } as any);
      classifier.classify.mockResolvedValue({
        state: 'classified',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        modelId: 'groq/qwen',
        themes: [],
        intents: ['walk'],
        traits: [],
        reasoningEvidence: [
          {
            facet: 'intent:walk',
            evidenceKeys: ['w1'],
            reason: 'real evidence',
          },
        ],
      });

      const result = await service.acquireOrReuse({
        anchor: { rawName: 'San Telmo', kind: 'area', priority: 'must' },
        intentKey: 'walk',
        destination: {
          destinationName: 'Buenos Aires',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 20_000,
        },
        geographicScope: {
          kind: 'AREA_BOUNDARY',
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        deficit: {
          origin: 'preference_facet',
          dimension: 'intent',
          key: 'walk',
          reason:
            'Preference facet [intent:walk] has no strong catalog match yet.',
        } as PreferenceFacetDeficit,
      });

      expect(result.outcome).toBe('acquired');
      if (result.outcome !== 'no_result') {
        const persisted = await prisma.experience.findUnique({
          where: { id: result.experienceId },
        });
        expect(persisted?.canonicalName).toBe('San Telmo Historical Walk');
        expect(persisted?.canonicalName).not.toBe('Food Crawl San Telmo');
      }
    });
  });

  describe('AreaRouteWalkAcquisitionService end-to-end reuse-first (K — real resolver/validator/catalog, mocked classifier + acquisition routing)', () => {
    it('acquires a tourism-route Experience once, then reuses it on a second identical request without reacquiring', async () => {
      const osmPlaces = emptyOsmPlaces();
      const geographicValidator = new CompositeGeographicValidationService();
      const resolver = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog,
        geographicValidator,
      );
      const embeddingIndexer = {
        index: jest.fn().mockResolvedValue({ status: 'unavailable' }),
      };
      // Cutover M4: classification runs inside
      // ExperienceAcquisitionService.materializeExecution() now (the
      // shared canonical materialization boundary) -- the classifier is a
      // dependency of THAT service, not of AreaRouteWalkAcquisitionService.
      const classifier = { classify: jest.fn() };
      const acquisitionService = new ExperienceAcquisitionService(
        catalog,
        embeddingIndexer as any,
        undefined,
        undefined,
        undefined,
        undefined,
        resolver,
        undefined,
        undefined,
        undefined,
        classifier as any,
      );
      const acquisitionPlanner = new ExperienceAcquisitionPlannerService();
      const anchorResolver = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog,
      );
      const service = new AreaRouteWalkAcquisitionService(
        anchorResolver,
        catalog,
        acquisitionPlanner,
        acquisitionService,
      );

      const rutaCandidate: ExperienceCandidate = {
        name: 'Ruta del Vino de Mendoza',
        themes: [],
        traits: [],
        intents: [], // real B6 shape -- empty
        evidenceKeys: ['wine-1', 'wine-2'],
        shortReason: 'grounded',
        componentHints: [
          {
            key: 'w1',
            name: 'Bodega A',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['wine-1'],
          },
          {
            key: 'w2',
            name: 'Bodega B',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['wine-2'],
          },
        ],
      };
      // Cold-path resolution: matched directly via lookupPoisWithin so the
      // resolver's own component-hint matching resolves both wineries for
      // real (still no OSM route relation/way involved -- mode C, canonical
      // ROUTE never attempted since anchor.kind === 'route' but resolveRoute
      // finds no matching street below).
      osmPlaces.lookupPoisWithin.mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:1',
            name: 'Bodega A',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4, -34.6] },
            tags: {},
          },
          {
            id: 'osm:node:2',
            name: 'Bodega B',
            osmType: 'node',
            osmId: 2,
            geometry: { type: 'Point', coordinates: [-58.41, -34.61] },
            tags: {},
          },
        ],
      });

      jest.spyOn(acquisitionService, 'executePlan').mockResolvedValue({
        candidates: [rutaCandidate],
        observations: [],
        providerResults: {},
        evidence: [
          { key: 'wine-1', source: 'test', snippet: 's1' },
          { key: 'wine-2', source: 'test', snippet: 's2' },
        ],
      } as any);
      jest.spyOn(acquisitionPlanner, 'buildAcquisitionPlan').mockReturnValue({
        destination: { destinationName: 'Mendoza' },
        deficits: [],
        sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
        breadth: 'focused',
      } as any);
      classifier.classify.mockResolvedValue({
        state: 'classified',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        modelId: 'groq/qwen',
        themes: [],
        intents: ['route_like'],
        traits: [],
        reasoningEvidence: [
          {
            facet: 'intent:route_like',
            evidenceKeys: ['wine-1'],
            reason: 'real evidence',
          },
        ],
      });

      const input = {
        anchor: {
          rawName: 'Ruta del Vino de Mendoza',
          kind: 'route' as const,
          priority: 'must' as const,
        },
        intentKey: 'route_like' as const,
        destination: {
          destinationName: 'Buenos Aires',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 50_000,
        },
        geographicScope: {
          kind: 'AREA_BOUNDARY' as const,
          boundary: BUENOS_AIRES_BOUNDARY,
        },
        deficit: {
          origin: 'preference_facet',
          dimension: 'intent',
          key: 'route_like',
          reason:
            'Preference facet [intent:route_like] has no strong catalog match yet.',
        } as PreferenceFacetDeficit,
      };

      const round1 = await service.acquireOrReuse(input);
      expect(round1.outcome).toBe('acquired');

      const round2 = await service.acquireOrReuse(input);
      expect(round2.outcome).toBe('reused');
      if (round1.outcome !== 'no_result' && round2.outcome !== 'no_result') {
        expect(round2.experienceId).toBe(round1.experienceId);
      }

      // Real reuse-first proof: acquisition-plan/execute is invoked exactly
      // once across both requests.
      expect(acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalledTimes(1);
      expect(acquisitionService.executePlan).toHaveBeenCalledTimes(1);
    });
  });
});
