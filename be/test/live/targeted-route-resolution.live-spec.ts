import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import {
  INominatimApiService,
  NominatimResult,
} from 'src/modules/integrations/osm/interfaces/nominatim.interface';
import { OsmPlacesService } from 'src/modules/integrations/osm/services/osm-places.service';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import { DestinationScaleHint } from 'src/modules/tours/interfaces/tour-generation.interface';
import { DestinationAdminCompatibilityService } from 'src/modules/tours/services/destination-admin-compatibility.service';
import {
  TargetedRouteDestination,
  TargetedRouteResolutionResult,
  TargetedRouteResolverService,
} from 'src/modules/tours/services/targeted-route-resolver.service';
import { StructuredGeoEntityResolverService } from 'src/modules/tours/services/structured-geoentity-resolver.service';
import { routeRetrievalQueryVariants } from 'src/modules/tours/utils/route-retrieval-name.util';
import { destinationAcquisitionRadiusMeters } from 'src/modules/tours/utils/destination-acquisition-radius.util';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(5 * 60 * 1000);

/**
 * Stage 3 targeted-ROUTE + AREA destination-compatibility characterization
 * spike (2026-09-24). Real local Overpass + Nominatim; real
 * DestinationResolutionService for the destination. Does NOT touch
 * ExperienceProposalResolverService or any production call path.
 *
 *   set -a; source ../.env; source ../.env.spike.stage3-structured-geoentity-resolution; set +a
 *   RUN_SPIKE_PREFLIGHT=1 yarn test:live:discovery --testPathPattern=targeted-route-resolution
 *
 * Writes spikes/stage3-targeted-route-resolution-2026-09-24/matrix.json.
 * The ROUTE oracle ids below are EVALUATION ground truth only (manually
 * verified real OSM ways in CABA) -- they never reach any resolver.
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const describeIfRun = RUN ? describe : describe.skip;

const DESTINATION_TEXT = 'Buenos Aires, Argentina';
const DESTINATION_POINT = { latitude: -34.6037, longitude: -58.3816 };
const CONTINUITY_GAP_WHAT_IF_METERS = 60;

interface RouteCase {
  hint: string;
  purpose: string;
  /** Real CABA OSM way ids of the intended street; empty = negative case. */
  oracleWayIds: number[];
}

const ROUTE_CORPUS: RouteCase[] = [
  {
    hint: 'Defensa Street',
    purpose: 'mandatory control (English gloss)',
    oracleWayIds: [48113515],
  },
  {
    hint: 'Defensa',
    purpose: 'mandatory control; same name in 5+ GBA partidos',
    oracleWayIds: [48113515],
  },
  {
    hint: 'San Lorenzo Passage',
    purpose: 'mandatory control (English gloss)',
    oracleWayIds: [22697007],
  },
  {
    hint: 'Pasaje San Lorenzo',
    purpose:
      'mandatory control; OSM name is "San Lorenzo"; homonym inside CABA (Flores)',
    oracleWayIds: [22697007],
  },
  {
    hint: 'Caminito Street',
    purpose: 'mandatory control (English gloss)',
    oracleWayIds: [144844726],
  },
  {
    hint: 'Caminito',
    purpose: 'mandatory control; homonym in Lomas de Zamora',
    oracleWayIds: [144844726],
  },
  {
    hint: 'Florida Street',
    purpose: 'common name, many GBA homonyms',
    oracleWayIds: [19754358],
  },
  {
    hint: 'Balcarce',
    purpose:
      'common name; CABA street fragmented into non-node-sharing OSM ways',
    oracleWayIds: [22697008, 22697921],
  },
  {
    hint: 'Chile Street',
    purpose: 'common name; CABA fragments',
    oracleWayIds: [18828846, 55214180, 498945044],
  },
  {
    hint: 'Avenida de Mayo',
    purpose:
      'designator is part of the real OSM name (normalization must not break raw)',
    oracleWayIds: [17442200],
  },
  {
    hint: 'Pasaje Giuffra',
    purpose:
      'real CABA passage whose OSM name is "Doctor José M. Giuffra" (exact-name limitation)',
    oracleWayIds: [22697011],
  },
  {
    hint: 'Plaza Dorrego',
    purpose: 'negative: POI/plaza must never become a ROUTE',
    oracleWayIds: [],
  },
  {
    hint: 'El Zanjón de Granados',
    purpose: 'negative: POI must never become a ROUTE',
    oracleWayIds: [],
  },
  {
    hint: 'Bulevar Oroño',
    purpose: 'negative: real Rosario street, outside the destination universe',
    oracleWayIds: [],
  },
];

interface AreaCase {
  hint: string;
  purpose: string;
  expectation: 'COMPATIBLE_CANDIDATE' | 'NO_CONFIDENT_RESOLVED';
}

const AREA_CORPUS: AreaCase[] = [
  {
    hint: 'San Telmo',
    purpose: 'positive: CABA barrio',
    expectation: 'COMPATIBLE_CANDIDATE',
  },
  {
    hint: 'Recoleta',
    purpose: 'positive: CABA barrio',
    expectation: 'COMPATIBLE_CANDIDATE',
  },
  {
    hint: 'Monserrat',
    purpose: 'positive: CABA barrio',
    expectation: 'COMPATIBLE_CANDIDATE',
  },
  {
    hint: 'Belgrano',
    purpose: 'positive CABA barrio with homonyms in other provinces',
    expectation: 'COMPATIBLE_CANDIDATE',
  },
  {
    hint: 'San Martín',
    purpose:
      'negative: Partido de General San Martín (Provincia de Buenos Aires)',
    expectation: 'NO_CONFIDENT_RESOLVED',
  },
  {
    hint: 'La Plata',
    purpose: 'negative: same country, Provincia de Buenos Aires hierarchy',
    expectation: 'NO_CONFIDENT_RESOLVED',
  },
  {
    hint: 'Villa General Belgrano',
    purpose:
      'negative: same country, Partido de Lanús (Provincia de Buenos Aires) hierarchy',
    expectation: 'NO_CONFIDENT_RESOLVED',
  },
  {
    hint: 'Fisherton',
    purpose: 'negative: real barrio of Rosario (Santa Fe), another province',
    expectation: 'NO_CONFIDENT_RESOLVED',
  },
  {
    hint: 'Cerro de las Rosas',
    purpose:
      'negative: two real homonymous barrios, Córdoba and Catamarca, both other provinces',
    expectation: 'NO_CONFIDENT_RESOLVED',
  },
  {
    hint: 'Rosario',
    purpose: 'negative: homonym-free AREA in another province (Santa Fe)',
    expectation: 'NO_CONFIDENT_RESOLVED',
  },
];

const wayIdOf = (externalId: string) => Number(externalId.split(':')[2]);

function summarizeNominatim(results: NominatimResult[], oracle: number[]) {
  return {
    count: results.length,
    results: results.map((r) => ({
      id: `osm:${r.osmType}:${r.osmId}`,
      class: r.class,
      type: r.type,
      displayName: r.displayName,
      latitude: r.latitude,
      longitude: r.longitude,
    })),
    correctPresent: results.some(
      (r) => r.osmType === 'way' && oracle.includes(r.osmId),
    ),
  };
}

function summarizeTargeted(
  result: TargetedRouteResolutionResult,
  oracle: number[],
) {
  const containsOracle = (ids: string[]) =>
    ids.some((id) => oracle.includes(wayIdOf(id)));
  return {
    status: result.status,
    reason: result.reason,
    acquisitionQueryCount: result.acquisitionQueryCount,
    adminLookupCount: result.adminLookupCount,
    variants: result.variants,
    clusterCount: result.clusters.length,
    compatibleClusterCount: result.compatibleClusterCount,
    clusters: result.clusters.map((c) => ({
      canonicalName: c.canonicalName,
      segmentExternalIds: c.segmentExternalIds,
      representativeSegment: c.representativeSegment,
      geometryFacts: c.geometryFacts,
      compatibility: {
        verdict: c.compatibility.verdict,
        reason: c.compatibility.reason,
        candidateCountryCode: c.compatibility.candidateCountryCode,
        candidateHierarchy: c.compatibility.candidateHierarchy.map(
          (u) => `${u.adminLevel ?? '?'}:${u.name ?? '?'}`,
        ),
      },
      probedSegmentIds: c.probedSegmentIds,
      containsOracle: containsOracle(c.segmentExternalIds),
    })),
    correctClusterPresent: result.clusters.some((c) =>
      containsOracle(c.segmentExternalIds),
    ),
    correctResolved:
      result.status === 'RESOLVED' &&
      containsOracle(result.resolved!.segmentExternalIds),
    wrongResolved:
      result.status === 'RESOLVED' &&
      !containsOracle(result.resolved!.segmentExternalIds),
  };
}

describeIfRun(
  'Targeted ROUTE resolution + AREA destination compatibility -- spike (real providers)',
  () => {
    let moduleRef: TestingModule;
    let nominatim: INominatimApiService;
    let osmPlaces: OsmPlacesService;
    let compatibility: DestinationAdminCompatibilityService;
    let targeted: TargetedRouteResolverService;
    let structured: StructuredGeoEntityResolverService;
    let destination: TargetedRouteDestination;
    const matrix: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
    };
    const routeRows: unknown[] = [];
    const areaRows: unknown[] = [];

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      nominatim = moduleRef.get<INominatimApiService>('NominatimApiService', {
        strict: false,
      });
      osmPlaces = moduleRef.get(OsmPlacesService, { strict: false });
      compatibility = new DestinationAdminCompatibilityService(osmPlaces);
      targeted = new TargetedRouteResolverService(osmPlaces, compatibility);
      structured = new StructuredGeoEntityResolverService(
        nominatim,
        undefined,
        compatibility,
      );

      const destinationResolution = await moduleRef
        .get(DestinationResolutionService, { strict: false })
        .resolveDestination(
          DESTINATION_TEXT,
          DESTINATION_POINT,
          DestinationScaleHint.SETTLEMENT,
        );
      if (destinationResolution.scale !== 'area') {
        throw new Error(
          `Spike precondition: destination must resolve area-scale, got ${JSON.stringify(destinationResolution)}`,
        );
      }
      const boundary = destinationResolution.boundary;
      const radius = destinationAcquisitionRadiusMeters(
        DESTINATION_POINT,
        boundary.geometry,
      );
      if (!radius) throw new Error('Spike precondition: no boundary extent');
      const adminLevel = Number(boundary.tags.admin_level);
      destination = {
        name: boundary.name,
        countryCode: destinationResolution.countryCode,
        point: DESTINATION_POINT,
        acquisitionRadiusMeters: radius,
        boundary: {
          osmType: boundary.osmType === 'way' ? 'way' : 'relation',
          osmId: boundary.osmId,
          name: boundary.name,
          ...(Number.isFinite(adminLevel) ? { adminLevel } : {}),
        },
      };
      const destinationHierarchy =
        await osmPlaces.lookupContainingAdminUnits(DESTINATION_POINT);
      matrix.destination = {
        input: { text: DESTINATION_TEXT, point: DESTINATION_POINT },
        resolution: {
          scale: destinationResolution.scale,
          boundaryId: boundary.id,
          boundaryName: boundary.name,
          boundaryTags: boundary.tags,
          countryCode: destinationResolution.countryCode,
          attemptedQueries: destinationResolution.attemptedQueries,
        },
        context: destination,
        destinationPointHierarchy: destinationHierarchy.value.map(
          (u) =>
            `${u.adminLevel ?? '?'}:${u.name ?? '?'} (${u.osmType}/${u.osmId})`,
        ),
      };
    });

    afterAll(async () => {
      const outDir = path.join(
        __dirname,
        '../../../spikes/stage3-targeted-route-resolution-2026-09-24',
      );
      fs.mkdirSync(outDir, { recursive: true });
      matrix.route = routeRows;
      matrix.area = areaRows;
      fs.writeFileSync(
        path.join(outDir, 'matrix.json'),
        JSON.stringify(matrix, null, 2),
      );
      await moduleRef?.close();
    });

    it.each(ROUTE_CORPUS)(
      'ROUTE $hint',
      async ({ hint, purpose, oracleWayIds }) => {
        const variants = routeRetrievalQueryVariants(hint);

        // 1. Targeted OSM acquisition (strict topology = the gate result),
        //    plus a continuity-gap what-if recorded separately.
        const strict = await targeted.resolve({ name: hint, destination });
        const gapWhatIf = await targeted.resolve({
          name: hint,
          destination,
          continuityGapMeters: CONTINUITY_GAP_WHAT_IF_METERS,
        });

        // Evaluation only: the oracle seed ways plus every way topologically
        // connected to them (same strict cluster), so a control returning a
        // different segment of the same real street counts as correct.
        const oracleClusterWayIds = [
          ...new Set([
            ...oracleWayIds,
            ...strict.clusters
              .filter((c) =>
                c.segmentExternalIds.some((id) =>
                  oracleWayIds.includes(wayIdOf(id)),
                ),
              )
              .flatMap((c) => c.segmentExternalIds.map(wayIdOf)),
          ]),
        ];

        // 2. Old control: Nominatim bare-name free-form + soft viewbox bias,
        //    through the unchanged legacy structured-resolver ROUTE path.
        const oldRaw = await nominatim.search(hint, {
          countryCode: destination.countryCode,
          bias: DESTINATION_POINT,
        });
        const oldStatus = await structured.resolve({
          name: hint,
          expectedKind: 'ROUTE',
          destinationName: destination.name,
          destinationCountryCode: destination.countryCode,
          destinationPoint: DESTINATION_POINT,
        });

        // 3. Nominatim structured control (street + city), per variant.
        const structuredControl = [];
        for (const variant of variants) {
          const query = { street: variant.name, city: destination.name };
          const results = await nominatim.searchStructured(query, {
            countryCode: destination.countryCode,
            bias: DESTINATION_POINT,
          });
          structuredControl.push({
            variant: variant.variant,
            query,
            ...summarizeNominatim(results, oracleClusterWayIds),
          });
        }

        const row = {
          hint,
          purpose,
          oracleWayIds,
          oracleClusterWayIds,
          queryVariants: variants,
          overpassQueryShape:
            'way["highway"]["name"="<variant>"](around:<acquisitionRadiusMeters>,<destination point>); out geom;',
          oldNominatimBareName: {
            ...summarizeNominatim(oldRaw, oracleClusterWayIds),
            legacyStatus: oldStatus.status,
          },
          nominatimStructured: structuredControl,
          targetedOverpass: summarizeTargeted(strict, oracleWayIds),
          targetedOverpassContinuityGapWhatIf: {
            continuityGapMeters: CONTINUITY_GAP_WHAT_IF_METERS,
            status: gapWhatIf.status,
            reason: gapWhatIf.reason,
            clusterCount: gapWhatIf.clusters.length,
            compatibleClusterCount: gapWhatIf.compatibleClusterCount,
            correctResolved: summarizeTargeted(gapWhatIf, oracleWayIds)
              .correctResolved,
            wrongResolved: summarizeTargeted(gapWhatIf, oracleWayIds)
              .wrongResolved,
          },
        };
        routeRows.push(row);
        // eslint-disable-next-line no-console
        console.info(
          `[ROUTE ${hint}] old=${oldStatus.status}/${row.oldNominatimBareName.correctPresent} structured=${structuredControl.map((s) => s.correctPresent).join(',')} targeted=${strict.status} clusters=${strict.clusters.length} compatible=${strict.compatibleClusterCount} correctPresent=${row.targetedOverpass.correctClusterPresent} gapWhatIf=${gapWhatIf.status}`,
        );
        expect([
          'RESOLVED',
          'AMBIGUOUS',
          'NOT_FOUND',
          'INCOMPATIBLE',
        ]).toContain(strict.status);
      },
    );

    it.each(AREA_CORPUS)(
      'AREA $hint',
      async ({ hint, purpose, expectation }) => {
        const result = await structured.resolve({
          name: hint,
          expectedKind: 'AREA',
          destinationName: destination.name,
          destinationCountryCode: destination.countryCode,
          destinationPoint: DESTINATION_POINT,
          destinationBoundary: destination.boundary,
        });
        const candidates =
          result.status === 'RESOLVED'
            ? [result.candidate]
            : result.status === 'AMBIGUOUS'
              ? result.candidates
              : result.status === 'INCOMPATIBLE'
                ? (result.rejected ?? [])
                : [];
        const row = {
          hint,
          purpose,
          expectation,
          finalStatus: result.status,
          reason: 'reason' in result ? result.reason : undefined,
          resolvedCandidate:
            result.status === 'RESOLVED'
              ? result.candidate.externalId
              : undefined,
          destinationBoundary: destination.boundary,
          candidates: candidates.map((c) => ({
            externalId: c.externalId,
            canonicalName: c.canonicalName,
            structuralType: c.structuralType,
            latitude: c.latitude,
            longitude: c.longitude,
            verdict: c.destinationCompatibility?.verdict,
            verdictReason: c.destinationCompatibility?.reason,
            candidateCountryCode:
              c.destinationCompatibility?.candidateCountryCode,
            candidateHierarchy:
              c.destinationCompatibility?.candidateHierarchy.map(
                (u) =>
                  `${u.adminLevel ?? '?'}:${u.name ?? '?'} (${u.osmType}/${u.osmId})`,
              ),
          })),
        };
        areaRows.push(row);
        // eslint-disable-next-line no-console
        console.info(
          `[AREA ${hint}] ${result.status} ${row.resolvedCandidate ?? ''} :: ${row.candidates.map((c) => `${c.canonicalName} => ${c.verdict}/${c.verdictReason}`).join(' | ')}`,
        );
        expect([
          'RESOLVED',
          'AMBIGUOUS',
          'NOT_FOUND',
          'INCOMPATIBLE',
        ]).toContain(result.status);
      },
    );
  },
);
