# Bitácora de generación de tours

## Contexto

El wizard de creación de tours (`POST /tours/generate-tour` → `TourGenerationService.createTourFromWizard` → `TourActivityGenerationService.generateTourActivities`, en `be/src/modules/tours/services/`) combina varias fuentes de datos y un paso de IA para convertir las preferencias del usuario en un tour: búsqueda de actividades existentes en la DB, un crawl de Google Places si no hay nada cerca, candidatos de calles/límites de OSM y contexto narrativo de Wikidata/Wikipedia para actividades compuestas, y finalmente una llamada al LLM que arma el itinerario y se auto-reporta un "reasoning". Hoy es una caja negra: no hay forma de ver, desde la app, qué le llegó al LLM ni por qué terminó eligiendo lo que eligió.

Existe trabajo previo sin mergear en la rama `feat/tour-generation-evidence-panel` (commit `c6b8755`): agrega un campo `reasoning` a la respuesta del LLM, persiste un `tour.metadata.generationTrace` plano (`candidatesOffered` como texto, `aiReasoning`, `hallucinatedCount`, `duplicateCount`, `auditFindings`), un `generation-audit.util.ts` que corre chequeos determinísticos (horario/presupuesto) sobre los picks del LLM, y un panel `GenerationDebugPanel.tsx` gateado por `__DEV__` que renderiza todo eso como tabla. Este trabajo es la base de esta spec, pero tiene una limitación central: **no persiste nada de lo que devuelven OSM ni Wikidata/Wikipedia** — esos candidatos se arman en memoria para el prompt y se descartan; solo Google Places persiste indirectamente, como filas de `Activity` en la DB.

El pedido de esta spec: una bitácora real dentro de la app (no solo un panel de debug embebido) donde se pueda seguir, paso a paso, cómo el input del usuario se convierte en el tour final — qué devolvió cada fuente externa (Google/OSM/Wikidata-Wikipedia), qué razonó el LLM, y qué verificó la auditoría.

## Alcance

**Adentro**: instrumentar `generateTourActivities` (el único flujo que dispara el wizard hoy) con un trace estructurado por pasos, persistido en `tour.metadata.generationTrace`, y una pantalla nueva en la app para leerlo.

**Afuera** (explícitamente, confirmado con el usuario):
- `TourGenerationService.generateTour()` — método `@deprecated`, todavía usado por `TourLocationService` para generar un tour de relleno cuando hay menos de 3 "tours cercanos". No se instrumenta en esta pasada; no tiene bitácora.
- **Matching de candidatos por preferencias/embeddings.** Se detectó, investigando esta spec, que `generateTourActivities` elige candidatos únicamente por proximidad geográfica (Haversine, vía `ActivitiesService.findAll`) — ignora completamente los intereses/presupuesto/tipo de grupo que el usuario cargó en el wizard. La búsqueda semántica por embeddings (`VectorStoreService.findSimilarActivities`) existe y está indexada (cada `Activity` nueva se guarda con su embedding vía `saveActivityEmbedding`), pero solo se **consulta** dentro del método deprecated `generateTour()`, nunca en el flujo real del wizard. Esto quedó marcado como un problema de producto real por el usuario ("matchear por proximidad, ignorando completamente los input del usuario no parece algo razonable") y amerita su propio brainstorming/spec — **no se resuelve acá**. Esta spec solo documenta la ausencia (ver step `embeddings` abajo), no cambia el comportamiento de selección de candidatos.

## Modelo de datos

`tour.metadata.generationTrace` (esquema Trace V2 canónico estructurado por etapas):

```ts
type TraceStage =
  | 'tour_intent'                 // Captura normalizada del pedido y constraints
  | 'destination_resolution'      // Geocodificación y boundary autoritativo
  | 'catalog_initial_pool'        // Búsqueda inicial en catálogo existente
  | 'coverage_analysis'           // Evaluación de gaps temáticos y por formato
  | 'google_places_crawl'         // Adquisición de POIs vía Places
  | 'grounded_discovery'          // Búsqueda grounded de experiencias (SerpApi/Tavily + Groq/Gemini)
  | 'entity_resolution'           // Resolución de hints contra Places/OSM (sin persistencia)
  | 'geographic_validation'       // Validación geográfica determinística de componentes y polígonos
  | 'catalog_materialization'     // Persistencia transaccional de propuestas aceptadas al catálogo
  | 'candidate_pool'              // Pool unificado de candidatos para el itinerario
  | 'embeddings'                  // Re-ranking semántico por pgvector
  | 'daily_planning'              // Algoritmo determinístico de partición por días
  | 'llm_generation'              // Invocación del LLM para estructuración horaria y reasoning
  | 'tour_completeness'           // Validación de días completos y gaps temporales
  | 'tour_format_coverage'        // Verificación de cobertura de formatos requeridos
  | 'verification';               // Auditoría determinística y deduplicación final

interface TraceCandidate {
  source: 'db' | 'google_places' | 'osm' | 'wikidata' | 'grounded_discovery';
  id: string;
  name: string;
  detail?: string;
  offered: boolean;
  chosen: boolean;
}

interface GenerationTraceStep {
  stage: TraceStage;
  label: string;
  summary: string;
  status?: 'PASS' | 'WARN' | 'FAIL' | 'DEGRADED';
  providerStatus?: 'success' | 'failed' | 'fallback';
  degradedReason?: string;
  decision?: {
    outcome: string;
    details?: Record<string, any>;
  };
  resolution?: {
    totalProposals: number;
    acceptedCount: number;
    rejectedCount: number;
    rejectionReasons?: string[];
  };
  geographicValidation?: {
    validatorVersion: number;
    totalProposals: number;
    acceptedCount: number;
    rejectedCount: number;
    rejections?: Array<{ proposalName: string; reasons: string[] }>;
  };
  candidates?: TraceCandidate[];
}

interface GenerationTrace {
  version: 2;
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: GenerationAuditResult;
}
```

`candidatesOffered` (texto plano parseado hoy por `parseCandidatesOffered` en el frontend) se elimina — los `candidates` estructurados de cada step lo reemplazan, no hace falta reparsear texto formateado para prompt.

## Backend

Todos los cambios viven en `be/src/modules/tours/services/tour-activity-generation.service.ts`, partiendo de la base ya escrita en la rama `feat/tour-generation-evidence-panel` (a traer/rebasear sobre `feat/tour-flow-redesign` antes de implementar):

1. Declarar `const steps: GenerationTraceStep[] = []` al inicio de `generateTourActivities`, junto a las estructuras existentes (`candidateActivityIds`, `candidateOsmFeaturesById`, etc.).
2. **`db_search`**: al resolver `nearbyActivitiesSample`/`refreshedActivitiesSample`, push un step con esos candidatos (`detail` reusa los mismos campos que ya formatea `formatActivityForPrompt` — rating/precio/horario).
3. **`google_places_crawl`**: push solo dentro de la rama que efectivamente llama a `crawlAndSaveActivities` (si la proximidad ya encontró resultados, este step no se agrega).
4. **`osm_streets`** / **`osm_boundary`**: al resolver `streetCandidates`/`areaCandidate`, un step cada uno (`detail` = `osmType`/tags relevantes).
5. **`embeddings`**: nuevo — cuenta cuántos de los IDs en `candidateActivityIds` tienen embedding indexado (consulta simple, reusa `VectorStoreService` o una query directa a la columna de embedding) y arma el `summary` documentando la ausencia de uso real (texto fijo + el conteo). No tiene `candidates`.
6. **`wikidata_enrichment`**: dentro de `enrichCandidatesWithWikidata` (o inmediatamente después, en el llamador), push un step con los candidatos que tenían QID — `detail` = extracto truncado si pasó el content-safety filter, o "descartado por seguridad de contenido" si no.
7. **`llm_generation`**: después de `tourChain.invoke(...)`, push con `summary` = `aiResponse.reasoning`.
8. **`verification`**: después de `verifyAndDedupeActivities` y de correr `generation-audit.util.ts`, push con `summary` = conteo de alucinados/duplicados, `candidates` = los picks finales cruzados con `auditFindings.perActivity`.
9. En el `$transaction` final que ya escribe `generationTrace`, reemplazar `candidatesOffered` por `steps`, mantener `aiReasoning`/`hallucinatedCount`/`duplicateCount`/`auditFindings` igual que hoy.

No se toca `ActivitiesService.findAll`, `OsmPlacesService`, ni `WikidataApiService` — solo se lee lo que ya devuelven, no se les agrega responsabilidad nueva.

## Frontend

- **Eliminar** `fe/components/tour-details/GenerationDebugPanel.tsx` como panel embebido en `fe/app/tours/[id].tsx` — se reemplaza por un link.
- **Nuevo archivo** `fe/app/tours/[id]/bitacora.tsx`: pantalla propia, timeline vertical de `GenerationTraceStep[]`.
  - Header: nombre del tour + "Cómo se armó este recorrido".
  - Por step: `label` + `summary` siempre visibles; si `candidates.length > 0`, lista colapsable (`Pressable` + chevron, mismo patrón que el panel actual) con nombre/detail/badges `Ofrecido`/`Elegido`.
  - Step `llm_generation`: el `summary` (reasoning) se muestra completo, sin truncar.
  - Step `verification`: reusa la tabla de auditoría que ya existe en `GenerationDebugPanel.tsx` (`AUDIT_LABELS`, cruce con `auditFindings`), migrada a este archivo.
  - Estado vacío: si `tour.metadata.generationTrace` no existe (tour pre-feature, o generado vía `generateTour()` fuera de alcance) → "No hay bitácora disponible para este tour".
  - Carga única con `fetchTourById` al montar (mismo patrón que el resto de pantallas de tour) — sin polling, tiene sentido solo post-generación.
- **`fe/app/tours/[id].tsx`**: quitar el render de `GenerationDebugPanel`; agregar un link chico gateado por `__DEV__` (mismo criterio de hoy) que navegue a `/tours/${id}/bitacora`.

## Testing

- Backend: extender `be/src/modules/tours/utils/generation-audit.util.spec.ts` (ya existe) y agregar specs para la construcción de `steps` en `tour-activity-generation.service.spec.ts` — verificar que cada stage aparece con el shape correcto dado un set de candidatos/respuesta de IA mockeados.
- Frontend: sin test runner de unidades en `fe/` (confirmado en `CLAUDE.md`) — verificación manual con captura de pantalla real contra un tour generado localmente, más `node --stack-size=8000 ./node_modules/.bin/tsc --noEmit` (el `npx tsc` por defecto desborda el stack en este proyecto).
- No hay e2e nuevo necesario — la pantalla es `__DEV__`-only, fuera del alcance de los specs `@live` existentes.

## Pendiente (fuera de esta spec)

Matching de candidatos por preferencias del usuario (intereses/presupuesto/tipo de grupo) en `generateTourActivities`, hoy inexistente — la selección es puramente geográfica. Los embeddings ya se indexan pero no se consultan en este flujo. Necesita su propio brainstorming: qué tan lejos ir con proximidad + similitud semántica combinadas, cómo pesar preferencias explícitas del wizard contra similitud implícita, si conviene un umbral de radio dinámico. Marcado como próximo tema a retomar.
