import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  GenerationTraceStep,
  TraceCandidate,
} from '../interfaces/generation-trace.interface';
import {
  PlacesCrawlProvenance,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';
import { WikidataEnrichmentOutcome } from '@integrations/wikidata/interfaces/wikidata.interface';
import type { NeighborhoodScoringInput } from './neighborhood-shortlist.util';

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
  const providerRequestFailures =
    provenance.rejectedCountByReason.provider_request_failed ?? 0;
  const rejectedCandidateCount = Object.entries(
    provenance.rejectedCountByReason,
  ).reduce(
    (sum, [reason, count]) =>
      reason === 'provider_request_failed' ? sum : sum + count,
    0,
  );
  const requestFailureSuffix = providerRequestFailures
    ? ` Además, ${providerRequestFailures} consulta(s) al proveedor fallaron.`
    : '';

  return {
    stage: 'places_crawl',
    label: `Catalog refill · ${providerLabel}`,
    summary: failed
      ? `${providerLabel} falló (${cacheLabel}). Solicitados: ${provenance.requestedCount}; recibidos: ${provenance.receivedCount}; no se afirmó cobertura nueva.`
      : `${providerLabel} (${cacheLabel}) recibió ${provenance.receivedCount} resultados, persistió ${provenance.acceptedCount} y descartó ${rejectedCandidateCount}.${requestFailureSuffix}`,
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
    label: 'Elementos para experiencias compuestas (OSM/Overpass)',
    summary: providerFailure
      ? candidates.length > 0
        ? `${candidates.length} calles, vías o POIs OSM reales conservados; una parte de las consultas a Overpass falló y la cobertura puede estar incompleta.`
        : 'No se pudo consultar OSM/Overpass para obtener calles, vías o POIs; la ausencia de candidatos en esta generación no significa que no existan.'
      : candidates.length > 0
        ? `${candidates.length} calles, vías o POIs OSM reales encontrados, candidatos para una experiencia compuesta.`
        : providerResponded
          ? 'La consulta a OSM/Overpass respondió sin calles, vías o POIs reales utilizables para una experiencia compuesta.'
          : 'No se obtuvieron elementos OSM utilizables; esta etapa no registró si la consulta respondió vacía o se degradó.',
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
  resolution:
    | {
        scale: 'point';
        attemptedQueries?: string[];
        degradationReason?: string;
      }
    | {
        scale: 'area';
        boundary: OsmCandidate;
        attemptedQueries?: string[];
        selectedResult?: { displayName: string };
      },
): GenerationTraceStep {
  const attempted = resolution.attemptedQueries?.length
    ? ` Intentos: ${resolution.attemptedQueries.join(' → ')}.`
    : '';
  const degradationMessages: Record<string, string> = {
    missing_destination: 'No se recibió un destino textual.',
    no_area_candidate:
      'Nominatim no devolvió una ciudad/pueblo con límite utilizable.',
    candidate_mismatched_coordinates:
      'Los candidatos de ciudad encontrados no coincidían con las coordenadas seleccionadas.',
    boundary_unavailable:
      'Se identificó la ciudad, pero no se pudo obtener su límite OSM.',
    provider_failed: 'La resolución del destino falló y continuó degradada.',
  };

  return {
    stage: 'destination_resolution',
    label: 'Resolución del destino',
    summary:
      resolution.scale === 'area'
        ? `"${destinationText}" resolvió a un límite real de ciudad: ${resolution.boundary.name}. Se exploran sus barrios reales en vez de un único punto+radio.${attempted}`
        : destinationText
          ? `"${destinationText}" no resolvió a un límite de ciudad/pueblo real — se usa el punto+radio de siempre. ${degradationMessages[resolution.degradationReason || ''] || 'Motivo no registrado.'}${attempted}`
          : 'No se especificó un destino de texto — se usa el punto+radio de siempre.',
    providerStatus:
      resolution.scale === 'point' &&
      resolution.degradationReason === 'provider_failed'
        ? 'failed'
        : undefined,
    degradedReason:
      resolution.scale === 'point' && resolution.degradationReason
        ? degradationMessages[resolution.degradationReason]
        : undefined,
  };
}

export function buildNeighborhoodShortlistStep(
  allNeighborhoods: OsmCandidate[],
  shortlisted: OsmCandidate[],
  signals?: {
    existingFamilyCount: number;
    catalogCoveredCount: number;
    scoringInputs?: NeighborhoodScoringInput[];
    providerFailure?: string;
  },
): GenerationTraceStep {
  const shortlistedIds = new Set(shortlisted.map((c) => c.id));
  const scoringById = new Map(
    (signals?.scoringInputs ?? []).map((input) => [input.candidate.id, input]),
  );
  return {
    stage: 'neighborhood_shortlist',
    label: 'Barrios explorados (destino a nivel ciudad)',
    summary:
      allNeighborhoods.length > 0
        ? `${allNeighborhoods.length} barrios reales encontrados; ${shortlisted.length} explorados a fondo. Ranking por familia reutilizable, cobertura/prominencia de POIs validados y afinidad semántica disponible: ${signals?.existingFamilyCount ?? 0} con familia existente y ${signals?.catalogCoveredCount ?? 0} con POIs del catálogo. No se lanzaron consultas POI detalladas para puntuar barrios; los empates sin evidencia usan un orden determinista.`
        : signals?.providerFailure
          ? 'No se pudieron consultar los barrios del límite de esta ciudad; la generación continuó degradada.'
          : '0 barrios reales encontrados dentro del límite de esta ciudad.',
    providerStatus: signals?.providerFailure ? 'failed' : 'success',
    degradedReason: signals?.providerFailure,
    candidates: allNeighborhoods.map((c): TraceCandidate => {
      const scoring = scoringById.get(c.id);
      const scoringDetail = scoring
        ? [
            scoring.hasExistingFamily ? 'familia existente' : null,
            `${scoring.catalogPoiCount} POI(s) de catálogo`,
            `prominencia ${Number(scoring.catalogProminenceScore ?? 0).toFixed(2)}`,
            scoring.interestSimilarity == null
              ? 'afinidad semántica no disponible'
              : `afinidad semántica ${scoring.interestSimilarity.toFixed(2)}`,
          ]
            .filter(Boolean)
            .join(' · ')
        : null;
      return {
        source: 'osm',
        id: c.id,
        name: c.name,
        detail: [osmDetail(c), scoringDetail].filter(Boolean).join(' · '),
        offered: true,
        chosen: shortlistedIds.has(c.id),
      };
    }),
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
  outcome: WikidataEnrichmentOutcome,
): GenerationTraceStep {
  const withQid = candidates.filter((c) => !!c.tags.wikidata);
  const failed = outcome.providerFailed > 0 || outcome.safetyCheckFailed > 0;
  return {
    stage: 'wikidata_enrichment',
    label: 'Contexto narrativo (Wikidata/Wikipedia)',
    summary: `${outcome.withoutQid} sin QID; ${outcome.fetched} obtenidos; ${outcome.acceptedSafe} aceptados como seguros; ${outcome.rejectedUnsafe} rechazados como inseguros; ${outcome.providerFailed} afectados por fallo del proveedor; ${outcome.safetyCheckFailed} afectados por fallo del control de seguridad. La falta de narrativa no elimina candidatos del tour.`,
    providerStatus: failed ? 'failed' : 'success',
    degradedReason: outcome.providerFailed
      ? 'Falló el proveedor de Wikidata/Wikipedia.'
      : outcome.safetyCheckFailed
        ? 'Falló el control de seguridad; los extractos afectados no se usaron.'
        : undefined,
    candidates: withQid.map((c): TraceCandidate => {
      const qid = c.tags.wikidata as string;
      let detail = 'Wikidata no devolvió un extracto narrativo.';
      if (c.narrativeContext) {
        detail = c.narrativeContext.substring(0, 200);
      } else if (outcome.providerFailed) {
        detail = 'No se pudo consultar el proveedor de Wikidata.';
      } else if (outcome.safetyCheckFailedQids.has(qid)) {
        detail = 'El control de seguridad falló; el extracto no se usó.';
      } else if (outcome.rejectedUnsafeQids.has(qid)) {
        detail = 'El extracto fue rechazado por el control de seguridad.';
      } else if (outcome.fetchedQids.has(qid)) {
        detail =
          'La entidad fue obtenida, pero no aportó un extracto utilizable.';
      }
      return {
        source: 'wikidata',
        id: qid,
        name: c.name,
        detail,
        offered: !!c.narrativeContext,
        chosen: false,
      };
    }),
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
