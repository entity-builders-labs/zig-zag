import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { EXPERIENCE_GROUNDED_SEARCH_PROVIDER } from 'src/modules/tours/interfaces/experience-grounding.interface';
import { SerpApiGroundedSearchService } from 'src/modules/tours/services/serpapi-grounded-search.service';
import { TavilyGroundedSearchService } from 'src/modules/tours/services/tavily-grounded-search.service';
import { OsmPlacesService } from 'src/modules/integrations/osm/services/osm-places.service';
import { INominatimApiService } from 'src/modules/integrations/osm/interfaces/nominatim.interface';
import { PrismaService } from 'src/core/database/prisma.service';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(2 * 60 * 1000);

/**
 * PRE-B6 real-world tourism research spike -- infrastructure preflight.
 *
 * This is NOT a spike run (RW1-RW6). It proves the real production DI
 * wiring/provider classes this repo already has can reach the intended
 * spike topology (SerpAPI grounded search selected with no silent Tavily
 * fallback possible; local Overpass/Nominatim reachable through the real
 * `OsmPlacesService`/`NominatimApiService` classes; the dedicated spike
 * Postgres/PostGIS database reachable) -- see
 * docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md
 * and docs/superpowers/progress/2026-09-13-pre-b6-gates-progress.md.
 *
 * Gated behind its OWN flag (never `RUN_LIVE_DISCOVERY_TESTS`, which governs
 * the unrelated discovery-provider characterization suite) so it never runs
 * by accident:
 *
 *   set -a; source .env.spike; set +a
 *   RUN_SPIKE_PREFLIGHT=1 yarn test:live --testPathPattern=pre-b6-spike-infrastructure-preflight
 *
 * Requires (see .env.spike.example): GROUNDED_SEARCH_PROVIDER=serpapi,
 * NOMINATIM_API_URL/NOMINATIM_REVERSE_API_URL/OVERPASS_API_URL pointing at
 * the local `osm-local` Compose profile containers (healthy), and
 * DATABASE_URL/DIRECT_URL pointing at the dedicated `zigzag_spike_preb6`
 * database. Never runs against the shared dev database.
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const describeIfRun = RUN ? describe : describe.skip;

describeIfRun(
  'PRE-B6 spike infrastructure preflight (real DI, no mocks)',
  () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
    });

    afterAll(async () => {
      await moduleRef?.close();
    });

    describe('1. Grounded web discovery provider selection', () => {
      it('EXPERIENCE_GROUNDED_SEARCH_PROVIDER resolves to the real SerpApiGroundedSearchService instance', () => {
        expect(process.env.GROUNDED_SEARCH_PROVIDER).toBe('serpapi');
        const resolved = moduleRef.get(EXPERIENCE_GROUNDED_SEARCH_PROVIDER, {
          strict: false,
        });
        expect(resolved).toBeInstanceOf(SerpApiGroundedSearchService);
        expect(resolved).not.toBeInstanceOf(TavilyGroundedSearchService);
      });

      it('a real SerpApiGroundedSearchService instance exists and reports whether SERPAPI_API_KEY is configured (no live call spent here -- that is RW1+, not preflight)', () => {
        // Presence of the key is an infra fact worth recording in the
        // manifest; the actual live call happens in RW1, never here.
        expect(typeof process.env.SERPAPI_API_KEY).toBe('string');
        if (!process.env.SERPAPI_API_KEY) {
          // eslint-disable-next-line no-console
          console.warn(
            'SERPAPI_API_KEY is not set -- RW1+ would fail with missing_serpapi_key. Not a preflight failure by itself (DI selection is still correctly serpapi), but record this as an open INFRASTRUCTURE_GAP before running RW1.',
          );
        }
      });
    });

    describe('2/3/4/5. Local OSM topology reachable through the real provider classes', () => {
      it('NominatimApiService.search("San Telmo, Buenos Aires") returns a real OSM object suitable for AREA resolution', async () => {
        const nominatim = moduleRef.get<INominatimApiService>(
          'NominatimApiService',
        );
        const results = await nominatim.search('San Telmo, Buenos Aires', {
          countryCode: 'ar',
        });
        // eslint-disable-next-line no-console
        console.info(
          'Nominatim search("San Telmo, Buenos Aires"):',
          JSON.stringify(results, null, 2),
        );
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        const [top] = results;
        expect(['node', 'way', 'relation']).toContain(top.osmType);
        expect(typeof top.osmId).toBe('number');
        expect(typeof top.displayName).toBe('string');
        expect(top.displayName.length).toBeGreaterThan(0);
      });

      it('NominatimApiService.reverse() for a known San Telmo coordinate (Plaza Dorrego) is geographically sensible', async () => {
        const nominatim = moduleRef.get<INominatimApiService>(
          'NominatimApiService',
        );
        const result = await nominatim.reverse(-34.6212, -58.3731);
        // eslint-disable-next-line no-console
        console.info(
          'Nominatim reverse(-34.6212, -58.3731):',
          JSON.stringify(result, null, 2),
        );
        expect(result).not.toBeNull();
        expect(result?.address?.countryCode).toBe('AR');
      });

      it('NominatimApiService.search("Mendoza, Argentina") resolves (RW4 precondition)', async () => {
        const nominatim = moduleRef.get<INominatimApiService>(
          'NominatimApiService',
        );
        const results = await nominatim.search('Mendoza, Argentina', {
          countryCode: 'ar',
        });
        // eslint-disable-next-line no-console
        console.info(
          'Nominatim search("Mendoza, Argentina"):',
          JSON.stringify(results, null, 2),
        );
        expect(results.length).toBeGreaterThan(0);
      });

      it('OsmPlacesService.lookupBoundaryById resolves real San Telmo boundary geometry via local Overpass, using the osm_type/osm_id Nominatim just returned', async () => {
        const nominatim = moduleRef.get<INominatimApiService>(
          'NominatimApiService',
        );
        const osmPlaces = moduleRef.get(OsmPlacesService);
        const [top] = await nominatim.search('San Telmo, Buenos Aires', {
          countryCode: 'ar',
        });
        expect(top.osmType).not.toBe('node'); // an AREA needs a way/relation, not a bare point
        const boundary = await osmPlaces.lookupBoundaryById(
          top.osmType as 'way' | 'relation',
          top.osmId,
        );
        // eslint-disable-next-line no-console
        console.info(
          'Overpass lookupBoundaryById:',
          boundary.status,
          boundary.value ? JSON.stringify(Object.keys(boundary.value)) : null,
        );
        expect(boundary.status).toBe('success');
        expect(boundary.value).not.toBeNull();
      });
    });

    describe('6. Dedicated spike PostgreSQL/PostGIS database', () => {
      it('PrismaService is connected to the dedicated spike database, not the shared dev database', async () => {
        const prisma = moduleRef.get(PrismaService);
        const [{ current_database }] = await prisma.$queryRaw<
          { current_database: string }[]
        >`SELECT current_database()`;
        // eslint-disable-next-line no-console
        console.info('Connected database:', current_database);
        expect(current_database).not.toBe('zigzag');
        expect(current_database).toMatch(/spike/i);
      });

      it('the dedicated spike database starts with zero rows in every knowledge table the COLD baseline requires', async () => {
        const prisma = moduleRef.get(PrismaService);
        const counts = {
          experience: await prisma.experience.count(),
          experienceComponent: await prisma.experienceComponent.count(),
          experienceEvidence: await prisma.experienceEvidence.count(),
          experienceTrait: await prisma.experienceTrait.count(),
          geoEntity: await prisma.geoEntity.count(),
          geoEntityIdentity: await prisma.geoEntityIdentity.count(),
          traitDefinition: await prisma.traitDefinition.count(),
        };
        // eslint-disable-next-line no-console
        console.info(
          'Initial spike DB state:',
          JSON.stringify(counts, null, 2),
        );
        for (const count of Object.values(counts)) {
          expect(count).toBe(0);
        }
      });
    });
  },
);
