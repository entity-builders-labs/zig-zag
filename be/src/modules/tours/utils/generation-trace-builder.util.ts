import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  GenerationTraceStep,
  TraceCandidate,
} from '../interfaces/generation-trace.interface';
import {
  PlacesCrawlProvenance,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';

// Loosely typed on purpose — mirrors the rest of this file's candidates
// (ActivityWithDistance from ActivitiesService.findAll, whose Prisma Json
// `openingHours` field doesn't structurally match a narrow interface).
function activityDetail(act: any): string {
  const parts: string[] = [];
  if (act.rating != null) {
    const reviews =
      act.ratingCount != null ? ` (${act.ratingCount} reviews)` : '';
    parts.push(`rating ${act.rating}/5${reviews}`);
  }
  if (act.priceLevel != null) parts.push(`precio ${act.priceLevel}/5`);
  const weekdayText = act.openingHours?.weekdayText;
  if (weekdayText?.length) parts.push(`horario: ${weekdayText[0]}`);
  return parts.length > 0 ? parts.join(' · ') : 'sin datos adicionales';
}

export function buildDbSearchStep(
  candidates: any[],
  radiusKm: number,
): GenerationTraceStep {
  return {
    stage: 'db_search',
    label: 'Búsqueda por proximidad en la base de datos',
    summary:
      candidates.length > 0
        ? `${candidates.length} actividades encontradas en un radio de ${radiusKm}km.`
        : `Sin actividades existentes en un radio de ${radiusKm}km.`,
    candidates: candidates.map(
      (act): TraceCandidate => ({
        source: 'db',
        id: act.id,
        name: act.name,
        detail: activityDetail(act),
        offered: true,
        chosen: false,
      }),
    ),
  };
}

export function buildPlacesCrawlStep(
  candidates: any[],
  provenance: PlacesCrawlProvenance,
  failed = false,
): GenerationTraceStep {
  const providerLabel = placesProviderLabel(provenance.provider);
  const cacheLabel =
    provenance.cacheStatus === 'hit'
      ? 'cache hit'
      : provenance.cacheStatus === 'strict-miss'
        ? 'strict cache miss'
        : 'live provider call';
  const rejectedCount = Object.values(provenance.rejectedCountByReason).reduce(
    (sum, count) => sum + count,
    0,
  );

  return {
    stage: 'places_crawl',
    label: `Catalog refill · ${providerLabel}`,
    summary: failed
      ? `${providerLabel} falló (${cacheLabel}). Solicitados: ${provenance.requestedCount}; recibidos: ${provenance.receivedCount}; no se afirmó cobertura nueva.`
      : `${providerLabel} (${cacheLabel}) recibió ${provenance.receivedCount} resultados, persistió ${provenance.acceptedCount} y rechazó ${rejectedCount}.`,
    placesProvenance: provenance,
    candidates: candidates.map(
      (act): TraceCandidate => ({
        source: provenance.provider === 'google' ? 'google_places' : 'geoapify',
        id: act.id,
        name: act.name,
        detail: activityDetail(act),
        offered: true,
        chosen: false,
      }),
    ),
  };
}

function osmDetail(c: OsmCandidate): string {
  const tag =
    c.tags.highway || c.tags.admin_level || c.tags.leisure || c.osmType;
  return `${c.osmType} (${tag})`;
}

export function buildOsmStreetsStep(
  candidates: OsmCandidate[],
  providerFailure?: string,
  providerResponded?: boolean,
): GenerationTraceStep {
  return {
    stage: 'osm_streets',
    label: 'Calles cercanas (OSM/Overpass)',
    summary: providerFailure
      ? 'No se pudo consultar OSM/Overpass para obtener calles o vías; la ausencia de candidatos en esta generación no significa que no existan.'
      : candidates.length > 0
        ? `${candidates.length} calles/vías reales encontradas, candidatas para un recorrido compuesto.`
        : providerResponded
          ? 'La consulta a OSM/Overpass respondió sin calles/vías reales utilizables cerca de esta ubicación.'
          : 'No se obtuvieron calles/vías utilizables; esta etapa no registró si la consulta respondió vacía o se degradó.',
    providerStatus: providerFailure
      ? 'failed'
      : providerResponded
        ? 'success'
        : undefined,
    degradedReason: providerFailure,
    candidates: candidates.map(
      (c): TraceCandidate => ({
        source: 'osm',
        id: c.id,
        name: c.name,
        detail: osmDetail(c),
        offered: true,
        chosen: false,
      }),
    ),
  };
}

export function buildOsmBoundaryStep(
  area: OsmCandidate | null,
  providerFailure?: string,
  providerResponded?: boolean,
): GenerationTraceStep {
  return {
    stage: 'osm_boundary',
    label: 'Barrio/límite contenedor (OSM/Overpass)',
    summary: providerFailure
      ? 'No se pudo consultar OSM/Overpass para resolver el límite contenedor; esta generación continuó degradada y no pudo construir experiencias compuestas basadas en el área.'
      : area
        ? `Límite encontrado: ${area.name}.`
        : providerResponded
          ? 'La consulta a OSM/Overpass respondió sin un límite de barrio utilizable para esta ubicación; no se pudo generar un área para experiencias compuestas.'
          : 'No se obtuvo un límite contenedor utilizable; esta etapa no registró si la consulta respondió vacía o se degradó.',
    providerStatus: providerFailure
      ? 'failed'
      : providerResponded
        ? 'success'
        : undefined,
    degradedReason: providerFailure,
    candidates: area
      ? [
          {
            source: 'osm',
            id: area.id,
            name: area.name,
            detail: osmDetail(area),
            offered: true,
            chosen: false,
          },
        ]
      : [],
  };
}

export function buildDestinationResolutionStep(
  destinationText: string | undefined,
  resolution: { scale: 'point' } | { scale: 'area'; boundary: OsmCandidate },
): GenerationTraceStep {
  return {
    stage: 'destination_resolution',
    label: 'Resolución del destino',
    summary:
      resolution.scale === 'area'
        ? `"${destinationText}" resolvió a un límite real de ciudad: ${resolution.boundary.name}. Se exploran sus barrios reales en vez de un único punto+radio.`
        : destinationText
          ? `"${destinationText}" no resolvió a un límite de ciudad/pueblo real — se usa el punto+radio de siempre.`
          : 'No se especificó un destino de texto — se usa el punto+radio de siempre.',
  };
}

export function buildNeighborhoodShortlistStep(
  allNeighborhoods: OsmCandidate[],
  shortlisted: OsmCandidate[],
): GenerationTraceStep {
  const shortlistedIds = new Set(shortlisted.map((c) => c.id));
  return {
    stage: 'neighborhood_shortlist',
    label: 'Barrios explorados (destino a nivel ciudad)',
    summary:
      allNeighborhoods.length > 0
        ? `${allNeighborhoods.length} barrios reales encontrados; ${shortlisted.length} explorados a fondo (con familia curada existente o más POIs cercanos).`
        : '0 barrios reales encontrados dentro del límite de esta ciudad.',
    candidates: allNeighborhoods.map(
      (c): TraceCandidate => ({
        source: 'osm',
        id: c.id,
        name: c.name,
        detail: osmDetail(c),
        offered: true,
        chosen: shortlistedIds.has(c.id),
      }),
    ),
  };
}

export function buildEmbeddingsStep(
  offeredCount: number,
  indexedCount: number,
  interestsRequested: boolean,
): GenerationTraceStep {
  let summary: string;
  if (indexedCount === 0) {
    summary = interestsRequested
      ? `0 de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector. ` +
        'No hubo señal semántica disponible para aplicar a esta selección; el orden se degradó a rating y proximidad.'
      : `0 de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector. ` +
        'Esta generación tampoco tenía intereses declarados, por lo que se ordenó por rating y proximidad.';
  } else if (interestsRequested) {
    summary =
      `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector ` +
      'y estaban disponibles para el ranking solicitado por intereses. La disponibilidad por sí sola no prueba que el proveedor de la query embedding haya respondido.';
  } else {
    summary =
      `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector, ` +
      'pero no se solicitó ranking semántico porque esta generación no tenía intereses declarados; se ordenó por rating y proximidad.';
  }

  return {
    stage: 'embeddings',
    label: 'Embeddings (pgvector)',
    summary,
  };
}

export function buildWikidataEnrichmentStep(
  candidates: OsmCandidate[],
): GenerationTraceStep {
  const withQid = candidates.filter((c) => !!c.tags.wikidata);
  return {
    stage: 'wikidata_enrichment',
    label: 'Contexto narrativo (Wikidata/Wikipedia)',
    summary:
      withQid.length > 0
        ? `${withQid.length} candidatos con QID de Wikidata; ${
            withQid.filter((c) => !!c.narrativeContext).length
          } pasaron el filtro de seguridad de contenido y aportaron contexto narrativo.`
        : 'Ningún candidato de esta generación tenía un QID de Wikidata asociado.',
    candidates: withQid.map(
      (c): TraceCandidate => ({
        source: 'wikidata',
        id: c.tags.wikidata,
        name: c.name,
        detail: c.narrativeContext
          ? c.narrativeContext.substring(0, 200)
          : 'descartado por el filtro de seguridad de contenido',
        offered: !!c.narrativeContext,
        chosen: false,
      }),
    ),
  };
}

export function buildLlmGenerationStep(
  reasoning?: string,
): GenerationTraceStep {
  return {
    stage: 'llm_generation',
    label: 'Explicación no verificada del itinerario generado por IA',
    summary:
      (reasoning
        ? `Afirmaciones declaradas por el modelo; no constituyen verificación de transporte, horarios ni factibilidad: ${reasoning}`
        : undefined) ||
      'El modelo no devolvió un campo de razonamiento para esta generación.',
  };
}

export function buildVerificationStep(params: {
  hallucinatedCount: number;
  duplicateCount: number;
  pickedActivityIds: string[];
  candidatesByStage: TraceCandidate[][];
}): GenerationTraceStep {
  const pickedSet = new Set(params.pickedActivityIds);
  const chosen: TraceCandidate[] = [];
  for (const list of params.candidatesByStage) {
    for (const c of list) {
      if (pickedSet.has(c.id)) chosen.push({ ...c, chosen: true });
    }
  }
  return {
    stage: 'verification',
    label: 'Verificación anti-alucinación',
    summary:
      `${params.hallucinatedCount} pick(s) descartados por no matchear un candidato real, ` +
      `${params.duplicateCount} descartados por duplicados.`,
    candidates: chosen,
  };
}
