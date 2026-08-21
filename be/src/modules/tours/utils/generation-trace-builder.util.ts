import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  GenerationTraceStep,
  TraceCandidate,
} from '../interfaces/generation-trace.interface';

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

export function buildGooglePlacesCrawlStep(
  candidates: any[],
): GenerationTraceStep {
  return {
    stage: 'google_places_crawl',
    label: 'Crawl de Google Maps',
    summary:
      candidates.length > 0
        ? `La búsqueda local no encontró nada — el crawl a Google Maps encontró ${candidates.length} lugares nuevos.`
        : 'La búsqueda local no encontró nada y el crawl a Google Maps tampoco.',
    candidates: candidates.map(
      (act): TraceCandidate => ({
        source: 'google_places',
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
): GenerationTraceStep {
  return {
    stage: 'osm_streets',
    label: 'Calles cercanas (OSM/Overpass)',
    summary:
      candidates.length > 0
        ? `${candidates.length} calles/vías reales encontradas, candidatas para un recorrido compuesto.`
        : 'Sin calles/vías reales encontradas cerca de esta ubicación.',
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
): GenerationTraceStep {
  return {
    stage: 'osm_boundary',
    label: 'Barrio/límite contenedor (OSM/Overpass)',
    summary: area
      ? `Límite encontrado: ${area.name}.`
      : 'Sin un límite de barrio real conteniendo esta ubicación — no se pudo generar un área para experiencias compuestas.',
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

export function buildEmbeddingsStep(
  offeredCount: number,
  indexedCount: number,
  interestsUsedForRanking: boolean,
): GenerationTraceStep {
  return {
    stage: 'embeddings',
    label: 'Embeddings (pgvector)',
    summary: interestsUsedForRanking
      ? `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector, ` +
        'usado junto con el rating para priorizar candidatos según los intereses declarados.'
      : `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector, ` +
        'pero no se usaron para la selección: esta generación no tenía intereses declarados, así que se ' +
        'ordenó únicamente por rating y proximidad.',
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
    label: 'Generación del itinerario con IA',
    summary:
      reasoning ||
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
