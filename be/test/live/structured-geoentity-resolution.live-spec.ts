import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { INominatimApiService } from 'src/modules/integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from 'src/modules/integrations/google-places/interfaces/places-api.interface';
import {
  StructuredGeoEntityResolverService,
  StructuredExpectedKind,
  StructuredGeoEntityResolutionRequest,
} from 'src/modules/tours/services/structured-geoentity-resolver.service';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(2 * 60 * 1000);

/**
 * Stage 3 gate spike -- characterizes an ISOLATED structured provider-native
 * GeoEntity resolver (name + expectedKind + destination -> provider-native
 * canonical identity) against REAL Nominatim/Geoapify, for the corpus in
 * the 2026-09-24 structured-resolution task prompt. Does NOT touch
 * ExperienceProposalResolverService or any production call path.
 *
 *   set -a; source ../.env; source ../.env.spike.<name>; set +a
 *   RUN_SPIKE_PREFLIGHT=1 yarn test:live --testPathPattern=structured-geoentity-resolution
 *
 * Writes the full per-hint matrix to
 * spikes/stage3-structured-geoentity-resolution-2026-09-24/matrix.json
 * and a human-readable summary to summary.md, both used verbatim by the
 * assessment.md this spike's report is built from.
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const describeIfRun = RUN ? describe : describe.skip;

const DESTINATION = {
  destinationName: 'Buenos Aires, Argentina',
  destinationCountryCode: 'AR',
  destinationPoint: { latitude: -34.6037, longitude: -58.3816 },
};

interface CorpusEntry {
  group: 'A' | 'B' | 'C' | 'D';
  name: string;
  expectedKind: StructuredExpectedKind;
  note: string;
}

const CORPUS: CorpusEntry[] = [
  {
    group: 'A',
    name: 'Defensa Street',
    expectedKind: 'ROUTE',
    note: 'acquired-before-but-rejected (ROUTE-only OWN_QID workaround target)',
  },
  {
    group: 'A',
    name: 'Dorrego Square',
    expectedKind: 'PLACE',
    note: 'acquired-before-but-rejected',
  },
  {
    group: 'A',
    name: 'San Lorenzo Passage',
    expectedKind: 'ROUTE',
    note: 'acquired-before-but-rejected (Pasaje San Lorenzo)',
  },
  {
    group: 'A',
    name: 'El Zanjón de Granados',
    expectedKind: 'PLACE',
    note: 'acquired-before-but-rejected (IDENTITY_CONVERGENCE target)',
  },
  {
    group: 'B',
    name: 'Mafalda Statue',
    expectedKind: 'PLACE',
    note: 'acquisition miss observed; NOT_FOUND is a valid outcome',
  },
  {
    group: 'B',
    name: 'Caminito Street',
    expectedKind: 'ROUTE',
    note: 'acquisition miss observed; NOT_FOUND is a valid outcome',
  },
  {
    group: 'B',
    name: 'Boca Juniors Stadium',
    expectedKind: 'PLACE',
    note: 'acquisition miss observed; NOT_FOUND is a valid outcome',
  },
  {
    group: 'B',
    name: 'Ezeiza Mansion',
    expectedKind: 'PLACE',
    note: 'acquisition miss observed; NOT_FOUND is a valid outcome',
  },
  {
    group: 'C',
    name: 'Galería Güemes',
    expectedKind: 'PLACE',
    note: 'must not depend on map_to_area local pool completeness',
  },
  {
    group: 'D',
    name: 'Recoleta Cemetery',
    expectedKind: 'PLACE',
    note: 'negative control: must not resolve to Hotel Urban Suites Recoleta',
  },
  {
    group: 'D',
    name: 'Plaza Dorrego',
    expectedKind: 'PLACE',
    note: 'negative control: same/similar name within Buenos Aires (park vs cafe vs school)',
  },
  {
    group: 'D',
    name: 'San Martín',
    expectedKind: 'AREA',
    note: 'negative control: same name in many Argentine cities/partidos',
  },
  {
    group: 'D',
    name: 'Plaza San Martín',
    expectedKind: 'PLACE',
    note: 'negative control: two-or-more equally plausible provider-native results',
  },
  {
    group: 'D',
    name: 'Caminito',
    expectedKind: 'PLACE',
    note: 'negative control: PLACE search for a name whose ROUTE sibling is in Group B, checking no cross-kind contamination',
  },
];

/**
 * Addendum, not in the task's fixed corpus: the SAME forensic hints under
 * their real OSM/product name (rather than the corpus's English gloss),
 * to separate "the structured architecture cannot resolve this" from
 * "the input name given didn't match what OSM/Geoapify actually calls it"
 * -- a name-quality question, out of scope for this resolver per the task
 * (no per-place translation lists). Reported separately, never blended
 * into the corpus gate evaluation above.
 */
const REAL_NAME_ADDENDUM: CorpusEntry[] = [
  {
    group: 'A',
    name: 'Defensa',
    expectedKind: 'ROUTE',
    note: 'real OSM name for "Defensa Street"',
  },
  {
    group: 'A',
    name: 'Pasaje San Lorenzo',
    expectedKind: 'ROUTE',
    note: 'real OSM name for "San Lorenzo Passage"',
  },
  {
    group: 'B',
    name: 'Caminito',
    expectedKind: 'ROUTE',
    note: 'real OSM name for "Caminito Street" -- as ROUTE, distinct from the Group D PLACE probe of the same word',
  },
  {
    group: 'B',
    name: 'Estadio Alberto J. Armando',
    expectedKind: 'PLACE',
    note: 'real official name for "Boca Juniors Stadium"',
  },
  {
    group: 'D',
    name: 'Cementerio de la Recoleta',
    expectedKind: 'PLACE',
    note: 'real OSM name for "Recoleta Cemetery" negative control',
  },
];

interface MatrixEntry {
  hint: string;
  expectedKind: StructuredExpectedKind;
  query: string;
  provider: string;
  providerResultCount: number;
  rawResults: unknown;
  candidateList: unknown;
  finalStatus: string;
  reason: string;
}

describeIfRun(
  'Structured GeoEntity Resolution -- isolated spike (real providers)',
  () => {
    let moduleRef: TestingModule;
    let service: StructuredGeoEntityResolverService;
    let nominatim: INominatimApiService;
    let placesApi: IPlacesApiService;
    const matrix: MatrixEntry[] = [];

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      nominatim = moduleRef.get<INominatimApiService>('NominatimApiService');
      placesApi = moduleRef.get<IPlacesApiService>('PlacesApiService');
      service = new StructuredGeoEntityResolverService(nominatim, placesApi);
    });

    afterAll(async () => {
      const outDir = path.join(
        __dirname,
        '../../../spikes/stage3-structured-geoentity-resolution-2026-09-24',
      );
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'matrix.json'),
        JSON.stringify(matrix, null, 2),
      );
      // eslint-disable-next-line no-console
      console.info(
        `Wrote structured-resolution matrix to ${outDir}/matrix.json`,
      );
      await moduleRef?.close();
    });

    it.each(CORPUS)(
      '[$group] $name ($expectedKind)',
      async ({ name, expectedKind }) => {
        await runOne(name, expectedKind, false);
      },
    );

    it.each(REAL_NAME_ADDENDUM)(
      '[addendum:$group] $name ($expectedKind)',
      async ({ name, expectedKind }) => {
        await runOne(name, expectedKind, true);
      },
    );

    async function runOne(
      name: string,
      expectedKind: StructuredExpectedKind,
      isAddendum: boolean,
    ) {
      const request: StructuredGeoEntityResolutionRequest = {
        name,
        expectedKind,
        ...DESTINATION,
      };

      let rawResults: unknown;
      let provider = 'unknown';
      let providerResultCount = 0;
      if (expectedKind === 'PLACE') {
        const raw = await placesApi.searchText({
          textQuery: name,
          maxResultCount: 5,
          locationBias: {
            center: DESTINATION.destinationPoint,
            radius: 50_000,
          },
        });
        rawResults = raw.data;
        provider = placesApi.provider;
        providerResultCount = raw.data.length;
      } else {
        const raw = await nominatim.search(name, {
          countryCode: DESTINATION.destinationCountryCode,
          bias: DESTINATION.destinationPoint,
        });
        rawResults = raw;
        provider = 'nominatim';
        providerResultCount = raw.length;
      }

      const result = await service.resolve(request);

      const candidateList =
        result.status === 'RESOLVED'
          ? [result.candidate]
          : result.status === 'AMBIGUOUS'
            ? result.candidates
            : [];
      const reason =
        result.status === 'INCOMPATIBLE' ? result.reason : result.status;

      matrix.push({
        hint: name,
        expectedKind,
        query: name,
        provider,
        providerResultCount,
        rawResults,
        candidateList,
        finalStatus: result.status,
        reason,
        isAddendum,
      } as MatrixEntry & { isAddendum: boolean });

      // eslint-disable-next-line no-console
      console.info(
        `[${isAddendum ? 'addendum:' : ''}${name} / ${expectedKind}] provider=${provider} rawCount=${providerResultCount} -> ${result.status}`,
        JSON.stringify(candidateList, null, 2),
      );

      // This spike only characterizes and records real outcomes -- it does
      // not assert pass/fail per hint (Group B NOT_FOUND is valid, some
      // AMBIGUOUS outcomes are the honest correct answer). The gate
      // evaluation happens in the assessment.md against this matrix.
      expect(['RESOLVED', 'AMBIGUOUS', 'NOT_FOUND', 'INCOMPATIBLE']).toContain(
        result.status,
      );
    }
  },
);
