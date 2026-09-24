import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { INominatimApiService } from 'src/modules/integrations/osm/interfaces/nominatim.interface';
import {
  OsmCandidate,
  OsmPlacesService,
} from 'src/modules/integrations/osm/services/osm-places.service';
import { geometryContainsPoint } from 'src/modules/integrations/osm/utils/geojson-containment.util';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import { DestinationScaleHint } from 'src/modules/tours/interfaces/tour-generation.interface';
import { boundingBoxToCenterRadius } from 'src/modules/tours/utils/geometry-search-area.util';
import { isAreaScaleEligible } from 'src/modules/tours/utils/nominatim-match.util';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(10 * 60 * 1000);

/**
 * Stage 3 cutover pre-check (2026-09-24, section 8 of the cutover task):
 * does containment in the ALREADY-HYDRATED destination boundary geometry
 * give the same verdict as the admin-hierarchy (`is_in`) authority the
 * targeted-route spike validated? Compares, per real probe point:
 *   admin: destination boundary relation id is in the point's is_in set
 *   polygon: geometryContainsPoint(destination.boundary.geometry, point)
 * This is NOT map_to_area: no area-scoped acquisition happens here.
 *
 *   set -a; source ../.env; source ../.env.spike.stage3-structured-geoentity-resolution; set +a
 *   RUN_SPIKE_PREFLIGHT=1 npx jest --config ./test/jest-live.json --runInBand --testPathPattern=destination-policy-characterization
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const describeIfRun = RUN ? describe : describe.skip;

const ROUTE_NAMES = [
  'Defensa',
  'Caminito',
  'San Lorenzo',
  'Galería Güemes',
  // The downtown object's real OSM name; the exact name above only reaches
  // the Ramos Mejía homonym. Included as the known map_to_area-gap object.
  'Galería General Güemes',
];
const AREA_NAMES = ['San Martín', 'La Plata', 'San Telmo'];

describeIfRun('Destination policy: admin hierarchy vs hydrated polygon', () => {
  let moduleRef: TestingModule;
  const rows: unknown[] = [];
  let boundary: OsmCandidate;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const resolution = await moduleRef
      .get(DestinationResolutionService, { strict: false })
      .resolveDestination(
        'Buenos Aires, Argentina',
        { latitude: -34.6037, longitude: -58.3816 },
        DestinationScaleHint.SETTLEMENT,
      );
    if (resolution.scale !== 'area') throw new Error('expected area scale');
    boundary = resolution.boundary;
  });

  afterAll(async () => {
    const outDir = path.join(
      __dirname,
      '../../../spikes/stage3-destination-policy-characterization-2026-09-24',
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'matrix.json'),
      JSON.stringify(
        {
          destination: {
            id: boundary.id,
            name: boundary.name,
            adminLevel: boundary.tags.admin_level,
            geometryType: boundary.geometry.type,
          },
          rows,
        },
        null,
        2,
      ),
    );
    await moduleRef?.close();
  });

  const compare = async (
    label: string,
    kind: 'ROUTE_SEGMENT' | 'AREA',
    externalId: string,
    point: { latitude: number; longitude: number },
  ) => {
    const osmPlaces = moduleRef.get(OsmPlacesService, { strict: false });
    const started = Date.now();
    const admin = await osmPlaces.lookupContainingAdminUnits(point);
    const adminMs = Date.now() - started;
    const polygonStarted = Date.now();
    const polygon = geometryContainsPoint(
      boundary.geometry,
      point.longitude,
      point.latitude,
    );
    const polygonMs = Date.now() - polygonStarted;
    const adminInside =
      admin.status === 'success'
        ? admin.value.some(
            (u) => u.osmType === boundary.osmType && u.osmId === boundary.osmId,
          )
        : undefined;
    const row = {
      label,
      kind,
      externalId,
      point,
      adminStatus: admin.status,
      adminInside,
      polygonInside: polygon,
      agree: adminInside === polygon,
      adminMs,
      polygonMs,
      hierarchy: admin.value.map((u) => `${u.adminLevel}:${u.name}`),
    };
    rows.push(row);
    return row;
  };

  it.each(ROUTE_NAMES)('ROUTE %s: every segment probe', async (name) => {
    const osmPlaces = moduleRef.get(OsmPlacesService, { strict: false });
    const { latitude, longitude, radiusMeters } = boundingBoxToCenterRadius(
      boundary.geometry,
    );
    const lookup = await osmPlaces.lookupHighwaysByName({
      name,
      latitude,
      longitude,
      radiusMeters: Math.min(radiusMeters, 50_000),
    });
    expect(lookup.status).toBe('success');
    for (const segment of lookup.value.segments) {
      const middle = segment.geometry[Math.floor(segment.geometry.length / 2)];
      const row = await compare(name, 'ROUTE_SEGMENT', segment.externalId, {
        latitude: middle.lat,
        longitude: middle.lon,
      });
      // eslint-disable-next-line no-console
      if (!row.agree) console.warn('DISAGREE', JSON.stringify(row));
    }
  });

  it.each(AREA_NAMES)('AREA %s: Nominatim area candidates', async (name) => {
    const nominatim = moduleRef.get<INominatimApiService>(
      'NominatimApiService',
      { strict: false },
    );
    const results = await nominatim.search(name, {
      countryCode: 'AR',
      bias: { latitude: -34.6037, longitude: -58.3816 },
    });
    for (const r of results.filter(isAreaScaleEligible)) {
      const row = await compare(name, 'AREA', `osm:${r.osmType}:${r.osmId}`, {
        latitude: r.latitude as number,
        longitude: r.longitude as number,
      });
      // eslint-disable-next-line no-console
      if (!row.agree) console.warn('DISAGREE', JSON.stringify(row));
    }
  });
});
