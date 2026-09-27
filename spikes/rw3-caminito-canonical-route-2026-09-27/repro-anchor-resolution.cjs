// RW3 spike-only, read-only reproduction of the COLD `anchor_geo_resolution`
// outcome for the interpreted anchor {rawName: "Caminito", usage: named_path}.
//
// Runs the compiled production AreaRouteAnchorResolverService discovery
// branches (discoverArea / discoverRoute / discoverPlace + selectCandidate)
// against the SAME local Nominatim/Overpass the COLD run used, with the SAME
// destination scope (DestinationResolutionService on "Buenos Aires,
// Argentina"). Never persists: persistCandidate is not called; the catalog
// is a read stub equivalent to the empty COLD DB; the Places provider is a
// tripwire stub (the COLD run made zero Places requests).
//
//   (cd be && node ../spikes/rw3-caminito-canonical-route-2026-09-27/repro-anchor-resolution.cjs)
const path = require('node:path');
const dist = path.resolve(__dirname, '../../be/dist/src');
const { ConfigService } = require('@nestjs/config');
const { NominatimApiService } = require(`${dist}/modules/integrations/osm/services/nominatim-api.service`);
const { OverpassApiService } = require(`${dist}/modules/integrations/osm/services/overpass-api.service`);
const { OsmPlacesService } = require(`${dist}/modules/integrations/osm/services/osm-places.service`);
const { DestinationResolutionService } = require(`${dist}/modules/tours/services/destination-resolution.service`);
const { AreaRouteAnchorResolverService } = require(`${dist}/modules/tours/services/area-route-anchor-resolver.service`);

const config = new ConfigService({
  NOMINATIM_API_URL: 'http://localhost:8088/search',
  NOMINATIM_REVERSE_API_URL: 'http://localhost:8088/reverse',
  OVERPASS_API_URL: 'http://localhost:12345/api/interpreter',
  USE_MOCK_MAPS: 'false',
  MOCK_MAPS_MODE: 'strict',
});

function summarizeGeometry(g) {
  if (!g) return null;
  const flat = (c) => (typeof c[0] === 'number' ? [c] : c.flatMap(flat));
  const pts = flat(g.coordinates);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return {
    type: g.type,
    coordinateCount: pts.length,
    bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
  };
}

function summarizeOutcome(o) {
  if (o.status !== 'match') return o;
  const c = o.candidate;
  return {
    status: o.status,
    kind: c.kind,
    canonicalName: c.canonicalName,
    provider: c.provider,
    externalId: c.externalId,
    latitude: c.latitude,
    longitude: c.longitude,
    geometry: summarizeGeometry(c.geometry),
    routeIdentities: c.routeEntity?.identities?.map((i) => `${i.provider}:${i.externalId}`),
  };
}

async function main() {
  const nominatim = new NominatimApiService(config);
  const osmPlaces = new OsmPlacesService(new OverpassApiService(config), config);
  const destination = new DestinationResolutionService(nominatim, osmPlaces);
  const request = { latitude: -34.6037, longitude: -58.3816 };
  const dest = await destination.resolveDestination('Buenos Aires, Argentina', request, 'settlement');
  if (dest.scale !== 'area') throw new Error(`destination not area-scale: ${dest.scale}`);
  const geographicScope = { kind: 'AREA_BOUNDARY', boundary: dest.boundary };
  const placesTripwire = {
    provider: 'geoapify',
    searchText: async () => {
      throw new Error('TRIPWIRE: Places searchText reached (COLD made zero Places requests)');
    },
  };
  const catalogStub = { findGeoEntityIdsByIdentities: async () => [] };
  const resolver = new AreaRouteAnchorResolverService(osmPlaces, catalogStub, nominatim, placesTripwire, undefined);
  const anchor = { rawName: 'Caminito', usage: 'named_path', priority: 'must' };

  const rawNominatim = await nominatim.search(anchor.rawName, { countryCode: dest.countryCode });
  const [area, route, place] = await Promise.all([
    resolver.discoverArea(anchor, dest.countryCode, request, geographicScope),
    resolver.discoverRoute(anchor, geographicScope),
    resolver.discoverPlace(anchor, dest.countryCode),
  ]);
  const selected = resolver.selectCandidate([area, route, place]);
  const routeDetail = await resolver.targetedRouteResolver.resolve({ name: anchor.rawName, destination: geographicScope });

  const out = {
    destination: {
      boundaryName: dest.boundary.name,
      boundaryId: dest.boundary.id,
      countryCode: dest.countryCode,
    },
    nominatimSearchAsCalled: {
      query: anchor.rawName,
      countryCode: dest.countryCode,
      resultCount: rawNominatim.length,
      results: rawNominatim.map((r) => ({
        osm: `${r.osmType}:${r.osmId}`,
        displayName: r.displayName,
        latitude: r.latitude,
        longitude: r.longitude,
        category: r.category,
        type: r.type,
      })),
    },
    discoverArea: summarizeOutcome(area),
    discoverRoute: summarizeOutcome(route),
    discoverPlace: summarizeOutcome(place),
    discoverRouteFullGeometry: route.status === 'match' ? route.candidate.geometry : null,
    selectCandidate: selected ? summarizeOutcome(selected) : 'undefined (no single identity across kinds)',
    targetedRouteResolver: {
      status: routeDetail.status,
      reason: routeDetail.reason,
      variants: routeDetail.variants,
      clusters: routeDetail.clusters?.map((c) => ({
        segmentExternalIds: c.segmentExternalIds,
        compatibility: c.compatibility,
        geometry: summarizeGeometry(c.geometry),
      })),
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
