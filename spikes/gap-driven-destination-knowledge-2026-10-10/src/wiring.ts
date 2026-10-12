import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { NominatimApiService } from '../../../be/src/modules/integrations/osm/services/nominatim-api.service';
import { OsmPlacesService } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { OverpassApiService } from '../../../be/src/modules/integrations/osm/services/overpass-api.service';
import { SerperApiService } from '../../../be/src/modules/integrations/serper/services/serper-api.service';
import { DestinationScaleHint } from '../../../be/src/modules/tours/interfaces/tour-generation.interface';
import {
  DestinationResolution,
  DestinationResolutionService,
} from '../../../be/src/modules/tours/services/destination-resolution.service';
import { TargetedRouteResolverService } from '../../../be/src/modules/tours/services/targeted-route-resolver.service';
import aiConfig from '../../../be/src/shared/ai/ai.config';
import { LangChainService } from '../../../be/src/shared/ai/langchain.service';
import { AiCacheService } from '../../../be/src/shared/ai/services/ai-cache.service';
import { GeoEntityRef, GeoGeometry } from './contracts';
import { centroidOf } from './geometry';
import { OsmGeoResolver } from './grounding/identity';
import { Recorder, SpikeNoopAiCache } from './recording';
import { LlmPort, langChainLlm } from './research/llm';
import { WebTools, liveWebTools } from './research/tools';

/** Local OSM endpoints (docker osm-local profile), as in .env.spike.example. */
const LOCAL_OSM = {
  OVERPASS_API_URL: 'http://localhost:12345/api/interpreter',
  NOMINATIM_API_URL: 'http://localhost:8088/search',
  NOMINATIM_REVERSE_API_URL: 'http://localhost:8088/reverse',
};

/** Parses KEY=VALUE lines; values are never logged. */
export function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

export interface SpikeEnvironment {
  config: ConfigService;
  osm: OsmPlacesService;
  nominatim: NominatimApiService;
  routes: TargetedRouteResolverService;
  destinationResolution: DestinationResolutionService;
  /** Web tools for a destination locale; undefined when search is not configured. */
  webFor(countryCode?: string): WebTools | undefined;
  /** Present only when LLM credentials are configured (or replaying). */
  llm?: LlmPort;
  configured: { serper: boolean; llmProvider?: string; llmModel?: string };
}

export function buildEnvironment(recorder: Recorder, env: Record<string, string>, aiProvider?: string): SpikeEnvironment {
  const merged = { ...env, ...LOCAL_OSM, AI_CACHE_MODE: 'off', USE_MOCK_MAPS: 'false', ...(aiProvider ? { AI_PROVIDER: aiProvider } : {}) };
  const config = new ConfigService(merged);
  const overpass = recorder.wrap(new OverpassApiService(config), 'overpass', [
    'queryBoundaryByName', 'queryContainingBoundary', 'queryBoundaryById', 'queryAdminBoundariesWithinArea',
    'queryPoisWithinArea', 'queryPois', 'queryFeaturesNear', 'queryHighwaysByName', 'queryContainingAdminBoundaries',
  ]);
  const osm = new OsmPlacesService(overpass, config);
  const nominatim = recorder.wrap(new NominatimApiService(config), 'nominatim', ['search', 'searchStructured', 'reverse']);
  const routes = new TargetedRouteResolverService(osm);
  const destinationResolution = new DestinationResolutionService(nominatim, osm);

  const serper = new SerperApiService(config);
  const serperConfigured = serper.isConfigured();
  let llm: LlmPort | undefined;
  let identity: { provider: string; model: string } | undefined;
  if (merged.AI_PROVIDER || recorder.mode === 'replay') {
    // aiConfig reads process.env; scope the env for its construction only.
    const previous = { ...process.env };
    Object.assign(process.env, merged);
    try {
      const service = new LangChainService(aiConfig(), new SpikeNoopAiCache() as unknown as AiCacheService);
      llm = langChainLlm(recorder, service);
      identity = llm.identity;
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  }
  return {
    config, osm, nominatim, routes, destinationResolution,
    webFor: (countryCode) => (serperConfigured || recorder.mode === 'replay' ? liveWebTools(recorder, serper, countryCode) : undefined),
    ...(llm ? { llm } : {}),
    configured: { serper: serperConfigured, ...(identity ? { llmProvider: identity.provider, llmModel: identity.model } : {}) },
  };
}

export interface ResolvedDestination {
  resolution: Extract<DestinationResolution, { scale: 'area' }>;
  entity: GeoEntityRef;
  resolver: OsmGeoResolver;
}

/**
 * Real destination resolution (DestinationResolutionService) from the
 * wizard's label + selected coordinates. Area scale is required: corridor
 * and neighbourhood knowledge need a boundary.
 */
export async function resolveDestination(
  envr: SpikeEnvironment,
  label: string,
  point: { latitude: number; longitude: number },
): Promise<ResolvedDestination> {
  const resolution = await envr.destinationResolution.resolveDestination(label, point, DestinationScaleHint.SETTLEMENT);
  if (resolution.scale !== 'area') throw new Error(`destination resolved at point scale (${resolution.degradationReason ?? 'unknown'})`);
  const geometry = resolution.boundary.geometry as unknown as GeoGeometry;
  const entity: GeoEntityRef = {
    id: `geo:${resolution.boundary.id}`,
    kind: 'AREA',
    name: resolution.boundary.name,
    identities: [{ provider: 'openstreetmap', externalId: resolution.boundary.id }],
    geometry,
    centroid: centroidOf(geometry),
  };
  const resolver = new OsmGeoResolver(envr.osm, envr.nominatim, envr.routes, resolution.boundary, resolution.countryCode ?? 'ar');
  return { resolution, entity, resolver };
}
