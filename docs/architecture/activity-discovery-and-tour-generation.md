# Activity Discovery and Tour Generation

> **⚠️ Filename and most of this document predate the Experience Domain V2
> rearchitecture.** The live runtime model is `GeoEntity` (physical reality:
> `PLACE`/`AREA`/`ROUTE`) + `Experience` (the only schedulable tourism unit) —
> `Activity`/`ActivityKind`/`TourActivity` no longer exist anywhere in the
> schema or runtime (removed by migration `20260902120000_remove_activity_domain_v2`).
> **Jump straight to [Experience Domain V2 cutover](#experience-domain-v2-cutover-2026-09-02)
> near the bottom of this file for the current authoritative flow, and to
> `CLAUDE.md` for a current, dense architecture summary.** Everything between
> here and that section — "Architectural invariants" through "Activity
> proposal boundary" — describes the pre-V2 design and is kept only as
> historical/design-rationale context; do not treat it as current behavior.
> Many of its underlying *principles* (catalog-first, discovery proposes but
> never supplies trusted identity, transport-aware feasibility, deterministic
> selection) still hold in V2, just expressed over Experiences/GeoEntities
> instead of Activities — see `CLAUDE.md` for how each maps forward.
>
> **Status:** Some V2 stages already exist and others are planned/tracked as
> known gaps (see `CLAUDE.md` and
> `docs/superpowers/plans/2026-09-02-experience-domain-v2-recovery-completion-plan.md`).
> The current repository remains the source of truth for implementation status.
>
> **Mandatory reading:** Read this document (the V2 cutover section, at
> minimum — the historical sections for background if you have time) before
> changing Experience/tour generation, candidate retrieval/ranking,
> embeddings, destination resolution, multi-component Experiences, Google
> Places/OSM integrations, or Experience Discovery.

This document describes how Zig-Zag transforms user preferences into a
grounded tour while growing a reusable catalog of neighborhood walks, food and
architecture walks, and route-based experiences.

Related documents:

- [Destination-aware activity engine design](../superpowers/specs/2026-08-21-activity-engine-design.md) — historical, pre-V2
- [Destination-resolution implementation plan](../superpowers/plans/2026-08-21-activity-engine-destination-resolution.md) — historical, pre-V2
- [Candidate quality, discovery, and mobility implementation plan](../superpowers/plans/2026-08-21-activity-engine-quality-discovery-mobility.md) — historical, pre-V2
- [Generation bitacora design](../superpowers/specs/2026-08-20-generation-bitacora-design.md) — Bitácora V3 superseded some of this; see `generation-trace.interface.ts`
- [Adquisición de candidatos: guía informal del flujo](./main-flow-for-dummies.md) — historical, pre-V2, introducción intuitiva a "Verified pool"
- [Experience Domain V2 recovery/completion plan](../superpowers/plans/2026-09-02-experience-domain-v2-recovery-completion-plan.md) — **current**, checkpoint-by-checkpoint status

## Vista de negocio y producto

Esta vista explica la lógica del producto, no las clases internas ni el estado
de implementación de cada PR. La mayoría de los tours recorre solamente la
línea principal. Completar el catálogo y descubrir experiencias son caminos
condicionales. No existe un proveedor universalmente primero: el catálogo se
consulta siempre; Places recupera y verifica entidades; grounded Discovery
aporta significado turístico, experiencias y un perfil inicial cuando Zig-Zag
todavía no conoce suficientemente un destino.

```mermaid
flowchart TD
    A["Pedido del usuario<br/>destino, temas, formatos de experiencia,<br/>días, grupo, presupuesto y movilidad"]
    A --> B["1. Entender el pedido y el destino<br/>convertir elecciones en restricciones<br/>y ubicar la ciudad o zona real"]
    B --> C["2. Consultar primero el catálogo<br/>reutilizar lugares y experiencias<br/>que Zig-Zag ya verificó"]
    C --> K{"¿Zig-Zag conoce el destino<br/>y la intención solicitada?"}
    K -- Sí --> D["3. Personalizar y comprobar el conjunto<br/>afinidad con intereses + calidad<br/>+ cercanía según transporte"]
    K -- "Destino nuevo o conocimiento insuficiente" --> N["Bootstrap híbrido acotado<br/>Places Text Search + grounded Discovery<br/>cada resultado conserva su procedencia"]
    N --> R["Resolver, validar y deduplicar<br/>Places para POIs; OSM para áreas/rutas"]
    R --> C
    D --> E{"¿Hay cobertura suficiente<br/>para construir días coherentes?"}

    E -- Sí --> G["4. Armar alternativas por día<br/>variedad + duración + tiempos de traslado"]
    E -- No --> F["Completar solamente lo que falta<br/>POIs convencionales o experiencias temáticas"]
    F --> C

    G --> H["5. Planificador determinístico<br/>elige y propone horarios usando<br/>solamente Experiences verificadas"]
    H --> I["6. Verificación con reglas del sistema<br/>identidad, duplicados, ruta, horarios,<br/>duración y transporte"]
    I --> J{"¿El tour es realizable?"}
    J -- No --> K["Reordenar, reemplazar<br/>o reducir paradas"]
    K --> G
    J -- Sí --> L["7. Guardar una fotografía del tour<br/>actividades, orden, paradas efectivas<br/>y tramos estimados"]
    L --> M["Tour generado + bitácora<br/>para el usuario y para auditoría"]
```

El ciclo de completar cobertura y el de corregir un itinerario son acotados.
Si después de los intentos permitidos no queda un conjunto real y realizable,
Zig-Zag informa el problema; nunca rellena el tour con lugares inventados.

### Por qué existe cada paso

| Acción                          | Por qué se ejecuta                                                                                                                                                                            | Resultado esperado                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Entender el pedido              | Intereses, ritmo y transporte significan cosas diferentes. Caminar como transporte, por ejemplo, no implica pedir una caminata temática.                                                      | Un criterio explícito para personalizar y comprobar factibilidad.                                          |
| Resolver el destino real        | Un nombre puede ser ambiguo y un radio alrededor de un punto puede representar mal una ciudad completa.                                                                                       | Ciudad/zona autoritativa o punto con radio, usados para desambiguar y contener resultados.                 |
| Consultar el catálogo primero   | Reutilizar entidades verificadas mejora consistencia, velocidad y costo, y evita repetir llamadas externas.                                                                                   | Pool inicial de POIs y experiencias reutilizables.                                                         |
| Personalizar                    | La similitud semántica aproxima qué actividades responden mejor a los intereses declarados.                                                                                                   | Actividades ordenadas por afinidad, sin confundir relevancia con verdad.                                   |
| Comprobar calidad y geografía   | Muchos resultados relevantes pueden estar demasiado separados, ser débiles o no formar un día posible para el transporte elegido.                                                             | Grupos candidatos con evidencia y coherencia espacial.                                                     |
| Analizar cobertura              | Evita llamar a proveedores solamente porque el ranking no es perfecto y evita aceptar un conteo alto pero inútil. También distingue catálogo conocido de destino todavía no perfilado.        | Decisión explícita: continuar, completar POIs, descubrir conceptos o inicializar conocimiento del destino. |
| Completar POIs convencionales   | Cuando faltan entidades concretas, Google Places Text Search puede recuperar atracciones relevantes y Nearby puede cubrir un tipo o zona faltante.                                            | Nuevos POIs admitidos únicamente después de validar identidad, evidencia y ubicación.                      |
| Descubrir significado turístico | Places devuelve entidades, pero no garantiza una lista completa de imperdibles ni propone bien experiencias como una caminata histórica. Un proveedor grounded propone conceptos con fuentes. | `ExperienceCandidate` con evidencia; todavía no es un Experience ni identidad confiable.                       |
| Resolver una propuesta          | El significado propuesto debe vincularse con un área, lugares, calles o caminos reales.                                                                                                       | Entidades verificadas con Google Places y OSM, o un rechazo explícito.                                     |
| Armar días                      | La selección final es un problema de conjunto: variedad, duración y traslados importan además del puntaje individual.                                                                         | Alternativas viables y acotadas por día.                                                                   |
| Selección y planificación determinísticas | El solver combina y calendariza únicamente Experiences verificadas; ningún LLM inventa ni selecciona unidades de agenda. | IDs de Experience y una propuesta compacta de agenda. |
| Verificación con reglas         | Una explicación convincente de la IA no demuestra rutas, horarios ni identidad.                                                                                                               | Tour corregido, reducido o rechazado según datos controlados por el backend.                               |
| Guardar una fotografía          | Las Experiences compartidas pueden evolucionar; un tour histórico no debe cambiar retroactivamente.                                                                                            | Orden, tramos y waypoints efectivos preservados al momento de generación.                                  |

### Qué debe expresar el wizard

El wizard no debe comprimir decisiones de producto distintas en un único
campo. En particular, estas tres elecciones son independientes:

```mermaid
flowchart LR
    U["Preferencias del usuario"] --> E["Formato de experiencia<br/>¿quiere caminatas, rutas<br/>o visitas puntuales?"]
    U --> M["Modos de traslado permitidos<br/>a pie, bici, auto,<br/>transporte público"]
    U --> F["Tolerancia física diaria<br/>distancia total a pie +<br/>máximo tramo continuo"]
    U --> P["Preferencias adicionales<br/>texto libre complementario<br/>acotado y trazable"]

    E --> D["CoverageAnalyzer y Discovery<br/>qué kinds/themes deben existir"]
    P --> D
    M --> S["Selección espacial<br/>qué conexiones son posibles"]
    F --> S
    S --> R["Ruta y agenda factibles por día"]
```

“Caminar” como modo de traslado no significa “quiero una caminata histórica”.
Del mismo modo, elegir una caminata temática no autoriza al motor a superar el
esfuerzo físico aceptado. El contrato canónico separa:

- `experienceFormats`: formatos deseados, por ejemplo visitas puntuales,
  caminatas de barrio, rutas temáticas y experiencias;
- `explorationStyle`: balance entre imperdibles, descubrimiento local y
  profundidad temática;
- `allowedTransportationModes`: modos que el planificador puede asignar a un
  tramo;
- `maxWalkingDistancePerDayMeters`: presupuesto acumulado de caminata por día;
- `maxContinuousWalkingDistanceMeters`: máximo aceptable para un único tramo
  peatonal;
- `travelPace` y restricciones de accesibilidad/grupo: modificadores de
  duración y factibilidad, no sustitutos de las distancias máximas.
- `additionalPreferences`: texto libre complementario para necesidades que el
  wizard todavía no modela de forma estructurada. Se recorta, valida, persiste
  y traza; nunca reemplaza restricciones tipadas ni convierte nombres o
  afirmaciones del usuario en entidades verificadas.

Para una primera UI conviene ofrecer perfiles comprensibles como “caminar lo
mínimo”, “moderado” y “me gusta caminar”, mostrando su equivalencia aproximada
en kilómetros por día y permitiendo personalizarla. El valor se aplica por día,
no al tour completo: un límite global sería ambiguo al comparar viajes de uno y
cinco días. Los rangos concretos son configuración de producto versionada y no
deben quedar ocultos dentro del prompt del LLM.

El texto libre no es un prompt alternativo ni una vía para evitar el contrato
canónico. Entra una sola vez al documento de intención que ve el selector de
itinerario; el ranking semántico puede incorporarlo a la consulta y el módulo de Discovery a los gaps
de Discovery. Las preferencias estructuradas son autoritativas cuando existe
un campo específico. Por ejemplo, una restricción alimentaria elegida en el
wizard no puede ser anulada escribiendo lo contrario en texto libre.

### Qué ocurre cuando falta cobertura

```mermaid
flowchart LR
    A["Catálogo + estado de conocimiento<br/>describen qué falta"] --> B{"¿Qué falta?"}

    B -- "Lugares convencionales (POIs)" --> C["Google Places Text Search<br/>atracciones prominentes del destino"]
    B -- "Tipo o zona convencional concreta" --> D["Google Places Nearby Search<br/>cobertura secundaria y acotada"]
    C --> E["Validar, deduplicar<br/>y admitir en el catálogo"]
    D --> E

    B -- "Destino nuevo sin perfil" --> J["Bootstrap contrastado<br/>Text Search + grounded Discovery"]
    J --> F
    J --> E
    B -- "Experiencia, imperdibles o criterio cualitativo" --> F["Búsqueda web fundamentada<br/>propone conceptos, lugares y entidades"]
    F --> G["Google Places resuelve POIs<br/>OSM resuelve áreas, calles y rutas"]
    G --> H["Validar coherencia temática,<br/>geográfica y estructural"]
    H --> E

    E --> I["Preparar para futuras búsquedas<br/>por intereses y reevaluar cobertura"]
```

Text Search y Nearby Search son operaciones distintas de Google Places. Text
Search es la adquisición principal de POIs cuando existe una consulta turística
o temática concreta. Nearby es cobertura secundaria para un tipo o zona
faltante; no determina qué es imperdible y sus anchors nunca representan
relevancia turística. Ninguna crea composites. Una nueva composite nace de una
propuesta de Discovery, se resuelve contra entidades reales y se valida antes
de entrar al catálogo. Una composite que ya existe se reutiliza desde la
consulta inicial sin volver a descubrirla.

---

> ## ⚠️ HISTORICAL — pre-V2 Activity design, superseded
>
> Everything from here through **"Change checklist"** describes the
> `Activity`/`ActivityKind`/`TourActivity` model, which no longer exists in
> this codebase (removed by migration `20260902120000_remove_activity_domain_v2`).
> An "itinerary LLM" that "selects real Activity IDs" (invariant 6 below, and
> others) is also no longer accurate — V2 has **no LLM in ranking/selection/
> scheduling at all**, only a deterministic solver (see `CLAUDE.md`). Kept for
> design-rationale/history; skip to
> [Experience Domain V2 — provider boundaries](#experience-domain-v2--provider-boundaries)
> and [Experience Domain V2 cutover](#experience-domain-v2-cutover-2026-09-02)
> for the current flow.

## Architectural invariants

1. Query the existing catalog before external acquisition. This does not mean
   that a high row count proves destination knowledge: an unprofiled or stale
   destination may still require one bounded hybrid bootstrap.
2. Keep Destination Resolution and Activity Discovery separate.
3. Discovery proposes semantic ideas; it never supplies trusted coordinates,
   Google Place IDs, OSM IDs, or geometry.
4. Google Places and OSM supply authoritative identity and geometry.
5. Persist only fully resolved and validated Activities.
6. The itinerary LLM may select only real Activity IDs offered by the backend.
7. Embedding similarity is a relevance signal, not proof of identity or truth.
8. Semantic relevance and spatial feasibility are separate decisions. A set of
   strong semantic matches is not sufficient unless it forms a viable tour.
9. The user's allowed transportation modes must drive deterministic travel-time
   analysis, spatial grouping, per-day routing, and feasibility validation. A
   prompt instruction is not enforcement.
10. Coverage means enough relevant Activities that can form feasible per-day
    groups for the requested transport, pace, and duration; it is not a raw
    candidate count.
11. For the first transport release, Zig-Zag owns leg feasibility, the selected
    mode, and a conservative time/distance estimate. Google Maps owns live
    transit lines, transfers, and turn-by-turn navigation.
12. Composite Activities are reusable catalog Activities grouped into stable
    families and variants. Waypoint content is not variant identity.
13. TourActivityWaypoint stores the effective ordered waypoint set used by a
    tour so later variant edits do not rewrite that set.
14. OSM streets and paths must never be materialized as kind=POI.
15. ActivityWaypoint continues to reference reusable Activity rows. Do not add
    a GeoFeature table without a demonstrated requirement.
16. Waypoint lifecycle changes are explicit: merge, replace/remove, or archive
    rather than silently corrupting a composite.
17. Provider/index availability and LLM reasoning are not verification. The
    generation bitacora may claim a semantic, transport, opening-hours, or
    feasibility signal was applied only when the corresponding deterministic
    stage records evidence that it actually ran successfully.
18. Background itinerary generation uses a compact selection contract. The
    LLM returns offered IDs plus scheduling intent, not duplicated names,
    coordinates, distances, travel times, or tour totals. After ID
    verification, the backend rehydrates canonical identity and geometry from
    the exact offered catalog candidates. A provider's failed or truncated
    draft is never salvaged as a verified itinerary.
19. Catalog-refill anchors are ordered by POI density (number of existing
    catalog POIs within each candidate's bounding box), then by proximity to
    the destination center. This replaces the earlier farthest-first k-center
    algorithm, which maximized geometric spread at the expense of tourism
    relevance — producing anchors in peripheral, low-tourism areas while
    skipping central ones. Anchors remain bounded geographic API coverage:
    they are not evidence that a neighborhood is touristic or suitable for a
    composite. Nearby/anchor acquisition is secondary gap filling, not the
    primary source of must-see relevance.
20. No provider is universally the discovery entry point. Existing catalog,
    Places Text Search, grounded Discovery, Places Nearby, and direct entity
    resolution have explicit triggers based on destination knowledge and user
    intent.
21. A grounded proposal is recommendation evidence, not authoritative entity
    identity. Citations are retained, but Places/OSM resolution and backend
    validation remain mandatory before persistence or itinerary selection.
22. Experience intent, transportation permission, and physical tolerance are
    separate inputs. “Walking” cannot be inferred to mean both a thematic walk
    and permission for an arbitrary amount of pedestrian travel.
23. Replaced generation paths are deleted in the same delivery sequence. Do
    not retain global OSM-neighborhood ranking, duplicate selectors, dormant
    adapters, or indefinite compatibility flags as speculative fallbacks.

## End-to-end flow

The primary architecture is intentionally expressed as five stages. Provider
calls, validation gates, and retry paths are conditional zooms into these
stages; they are not fourteen mandatory network calls on every tour request.

```mermaid
flowchart TD
    A["User input<br/>destination, themes, experience formats,<br/>days, group, budget, mobility limits"]
    A --> B["1. Resolve context<br/>intent + mobility + real destination"]
    B --> C["2. Build a verified candidate pool<br/>catalog first; acquire by explicit need"]
    C --> D["3. Select coherent daily sets<br/>relevance + quality + diversity<br/>+ mode-aware travel cost"]
    D --> E["4. Route and schedule each day<br/>travel times + duration + opening hours"]
    E --> F["5. Verify, snapshot, persist, respond<br/>canonical IDs + tour legs + bitacora"]

    C -. "conventional POI deficit" .-> R["Places acquisition zoom<br/>Text Search first; Nearby for bounded gaps"]
    R -. "validated Activities" .-> C
    C -. "new destination profile or qualitative/experience gap" .-> X["Grounded Discovery zoom<br/>proposal + entity resolution + validation"]
    X -. "validated Activities" .-> C
    E -. "infeasible day" .-> D
```

The catalog-growth loop does not mean that every generation crawls providers.
A healthy, already-profiled destination normally stays on the main line:
resolve, query the catalog, select, schedule, and persist. A previously unknown
destination may run one bounded bootstrap that contrasts Places POIs with
grounded recommendations; the resolved result is cached/reused. Later calls
are gap-driven and add only validated reusable Activities before reevaluation.

### What runs always and what is conditional

| Stage                  | Always on the generation path                                                                                                                | Conditional work                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Resolve context     | Normalize preferences and mobility; build a `DestinationContext` through Nominatim forward/reverse resolution.                               | Query Overpass for an authoritative boundary when the destination resolves as a city/neighborhood rather than a point.                                                                                                                                                           |
| 2. Verified pool       | Query eligible `POI`, `ROUTE`, `NEIGHBORHOOD_WALK`, and `EXPERIENCE` Activities from PostgreSQL and inspect destination-knowledge freshness. | Use direct Places resolution for named entities; Text Search for conventional POI gaps; Nearby for bounded type/zone gaps; grounded Discovery for a new destination profile, must-see/qualitative uncertainty, or missing experiences. Resolve all proposals through Places/OSM. |
| 3. Daily sets          | Apply semantic relevance, quality, diversity, and deterministic spatial feasibility to real Activity IDs.                                    | Generate a query embedding only when the configured embedding provider/index is available; report semantic ranking as unavailable and use documented non-semantic signals when it is not.                                                                                        |
| 4. Route and schedule  | Order each day and validate travel, activity duration, and available opening-hour constraints.                                               | Reselect, split, or remove stops when a day is infeasible. Detailed live transit/navigation remains outside the MVP.                                                                                                                                                             |
| 5. Persist and respond | Verify offered IDs, hydrate canonical data, persist `TourActivity` and effective `TourActivityWaypoint` snapshots, and emit the bitacora.    | Persist a newly validated composite only when the selected tour actually uses it or the catalog-growth policy explicitly materializes it.                                                                                                                                        |

### Provider-call guide

`Google Places` is the provider/API family. `Text Search` and `Nearby Search`
are two different Google Places operations with different purposes. Neither is
a fallback for the other.

| Call                                     | Exact trigger                                                                                                 | Problem it solves                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nominatim forward/reverse                | Stage 1, for destination resolution                                                                           | Disambiguates the user's label/coordinates into a normalized real place.                                                                                               |
| Overpass boundary                        | Stage 1, for an area-scale destination                                                                        | Supplies authoritative city/neighborhood containment geometry. It does not rank tourism and is not a routing engine.                                                   |
| Google Places Text Search                | Stage 2, for a conventional POI gap, new-destination bootstrap, or exact named-entity resolution              | Retrieves real Places candidates ordered by the provider's query relevance. It often finds iconic POIs, but is not treated as a complete curated must-see list.        |
| Google Places Nearby Search              | Stage 2, only for an explicit missing type/zone that needs bounded geographic coverage                        | Provides typed coverage using primary types, popularity, and hard circles. It is secondary to intent-driven Text Search; an anchor is coverage, not tourism relevance. |
| Geoapify category search                 | Stage 2, only when Geoapify is explicitly configured instead of Google                                        | Provides the category-based coverage that Geoapify actually supports; it does not imitate Google's Text Search.                                                        |
| Bedrock Titan / local Ollama             | Stage 3, when semantic retrieval is requested                                                                 | Produces query and Activity embeddings consumed by pgvector. Failure is explicit and never switches provider silently.                                                 |
| Grounded Discovery provider              | Stage 2, for an unprofiled/stale destination, qualitative must-see uncertainty, or a missing experience/theme | Proposes sourced `ActivityProposal` concepts and entity hints. It is one recommendation signal, not trusted identity or geometry and not an always-first provider.     |
| Google Places proposal resolution        | Only for discovered POI/venue hints                                                                           | Resolves a proposal hint to a real provider entity before validation.                                                                                                  |
| Nominatim + Overpass proposal resolution | Only for discovered streets, paths, routes, neighborhoods, or boundaries                                      | Resolves non-POI proposal hints and composite geometry.                                                                                                                |
| Wikidata/Wikipedia                       | Optionally, only when a resolved OSM entity has a QID                                                         | Adds narrative context. Missing narrative never invalidates the entity.                                                                                                |
| Configured itinerary LLM                 | Stage 3, after a feasible candidate window exists                                                             | Selects offered IDs and scheduling intent only; the backend verifies and rehydrates them.                                                                              |
| Travel-time provider                     | Stages 3-4, for bounded candidate pairs and final legs                                                        | Supplies mode-aware deterministic time/distance. OSM/Overpass data alone does not calculate a route.                                                                   |

When both are explicitly planned, Text Search and Nearby results are united
before the same geography, deduplication, identity, and admission gates.
Nearby is not an automatic retry after Text Search failure. Detailed request
shapes and evidence gates appear in
[Catalog Refill with destination anchors](#catalog-refill-with-destination-anchors).

Provider labels are explicit calls, not automatic fallback chains. If Google
is selected for Places, a failure does not invoke Geoapify. If Bedrock is
selected for embeddings, a failure does not invoke Ollama or OpenAI.
The configured LLM provider may change behind its adapter; the trace must
record which provider actually handled the operation.

### OSM composite resolution

The target path starts with one concrete grounded/reusable proposal. OSM does
not enumerate a city and decide which neighborhood tourists should want.

```mermaid
flowchart TD
    P["Resolved proposal or reusable family<br/>area/route/waypoint entity hints"] --> A["Resolve the proposed AREA<br/>Nominatim/OSM with destination context"]
    A --> B{"Exact real boundary<br/>inside destination?"}
    B -- No --> X["Reject proposal with reason"]
    B -- Yes --> D["Query bounded streets/paths/POIs<br/>inside that resolved area only"]
    D --> R["Resolve POI hints with Places<br/>and route/area hints with OSM"]
    R --> V["Validate identity, theme,<br/>membership, waypoint count and geometry"]
    V -- invalid --> X
    V -- valid --> C["Create/reuse ActivityFamily + variant<br/>ActivityWaypoint references"]
```

The target JSON-mode itinerary contract requires only `reasoning` and
`activities`. Every pick carries an offered reusable `activityId`,
day/time/duration, a bounded short note, and an optional verified waypoint
subset when that ID is an existing composite. It does not contain a
`compositeActivities` creation channel: new composites enter the catalog only
through grounded proposal resolution before itinerary selection. Server-owned
values are populated only after the anti-hallucination check. This prevents
long multi-day responses from spending the completion budget repeating
candidate data and then truncating before the JSON object closes. A
`json_validate_failed` draft does not enter the repair, verification, or
persistence path. If a later explicit retry succeeds, its non-failed status
removes the previous attempt's `generationError` and `generationFailedAt`;
stale failure metadata must not survive a completed run.

The old city-wide OSM enumeration and `CompositeAreaSelector` path is not a
supported fallback. It must be removed when this architecture is adopted, not
retained behind an indefinite feature flag. A temporary release may therefore
reuse existing catalog composites without creating new ones until grounded
proposal resolution is ready. That loss of speculative composite generation is
preferable to persisting plausible-sounding walks through arbitrary barrios.

Exact membership and boundary-hydration code belongs in the proposal resolver
only when it has an immediate production consumer. Do not commit unused
“future” abstractions merely because an earlier experiment implemented them.

Administrative ways that also carry `highway=*` are not neighborhood areas. A
way boundary is eligible only when it is a closed area. Street-name
placeholders remain ineligible for composite proposal or persistence.

Wikidata does not enrich every Google/Geoapify POI. It adds optional narrative
grounding only to already resolved OSM entities in a concrete proposal. A safe
extract may be stored as a composite `narrativeSource`; it
does not overwrite catalog POI prose. Missing QID, failed enrichment, or a
failed safety check removes only the optional narrative, not the candidate.

### Production topology: cold-destination OSM refill

The public Nominatim and Overpass community endpoints are not a mass-production
capacity layer. Retry, concurrency, and circuit-breaker logic protect the
application and those services, but cannot provide an SLA. At production
volume, normal tour requests should primarily reuse resolved OSM-backed
Activities from Zig-Zag's catalog.

```mermaid
flowchart TD
    REQ["Tour request"] --> CAT["PostgreSQL + pgvector<br/>query reusable Activities"]
    CAT --> COVER{"Destination and theme<br/>coverage sufficient?"}
    COVER -- Yes --> GEN["Generate from verified catalog<br/>no per-tour Overpass crawl"]
    COVER -- No --> REGION["RegionResolver<br/>coordinates -> smallest supported extract<br/>for example Granada -> Andalucía"]
    REGION --> REGISTRY{"RegionRegistry state<br/>missing / downloading / importing<br/>ready / failed"}
    REGISTRY -- ready --> JOB["Deduplicated asynchronous destination refill<br/>keyed by destination OSM identity"]
    REGISTRY -- "missing or failed retryable" --> IMPORT["One regional import job<br/>download PBF + build/update index"]
    REGISTRY -- "downloading or importing" --> WAIT["Join existing job<br/>never duplicate the import"]
    IMPORT --> REGISTRY
    WAIT --> REGISTRY

    JOB --> OSM["Production OSM query backend<br/>self-hosted or managed Overpass-compatible service"]
    JOB --> NOM["Production geocoder<br/>self-hosted or managed Nominatim-compatible service"]
    OSM --> VALIDATE["Resolve + validate identities, geometry and kinds"]
    NOM --> VALIDATE
    VALIDATE --> MATERIALIZE["Materialize reusable AREA / ROUTE / POI Activities<br/>and ActivityWaypoint references"]
    MATERIALIZE --> EMBED["Embedding provider<br/>Bedrock Titan in production"]
    EMBED --> CAT

    JOB -. "development or spike only" .-> PUBLIC["Public Nominatim / overpass-api.de<br/>strictly bounded and observable"]
```

This production topology is a required gate before enabling OSM-backed
composite generation at mass scale. It does not require a `GeoFeature` table:
resolved entities continue to use `Activity`, `ActivityFamily`, and
`ActivityWaypoint`. The refill worker and production OSM hosting/provider remain
bounded by environment; the repository remains the source of truth.

The critical boundary is:

```text
Discovery proposes meaning.
Entity Resolution supplies identity.
Validation authorizes persistence.
Tour Generation only selects verified Activities.
```

## Stage responsibilities

| Stage                        | Responsibility                                                                                                                                           | Must not do                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| UserIntentBuilder            | Normalize destination and preferences                                                                                                                    | Resolve external entities                                               |
| MobilityProfileBuilder       | Convert allowed transport, pace, days, and accessibility needs into routing constraints                                                                  | Treat every mode as walking or rely on prompt text                      |
| DestinationResolutionService | Normalize structured locality/country context, classify point vs area, validate the result against destination coordinates, and build DestinationContext | Blindly trust a provider-specific display label or discover experiences |
| ExistingActivityRetriever    | Retrieve geographically valid catalog Activities                                                                                                         | Call a discovery LLM                                                    |
| PlacesAcquisitionPlanner     | Choose direct resolution, Text Search, or bounded Nearby from the explicit POI deficit and provider budget                                               | Treat Nearby anchors or provider rank as a definitive must-see list     |
| SpatialFeasibilityAnalyzer   | Build mode-aware travel-time relationships and viable per-day candidate groups                                                                           | Use semantic similarity as a proxy for proximity                        |
| CoverageAnalyzer             | Measure quantity, themes, kinds, quality, destination-knowledge freshness, and transport-feasible per-day coverage                                       | Treat a raw candidate count as sufficient or persist Activities         |
| ActivityDiscoveryService     | Request sourced missing concepts or a bounded new-destination profile from a grounded provider                                                           | Act as authoritative identity, access Prisma, or persist output         |
| Entity Resolution            | Resolve hints through Places/OSM with destination context                                                                                                | Trust LLM identity or coordinates                                       |
| ActivityValidator            | Enforce semantic, geographic, structural, and transport rules                                                                                            | Repair by guessing                                                      |
| CompositeActivityService     | Reuse/persist validated area, family, variant, and waypoints                                                                                             | Persist raw proposals                                                   |
| Unified Ranking              | Select coherent candidate sets using relevance, quality, diversity, and travel cost                                                                      | Rank each Activity independently and ignore the resulting route         |
| Itinerary generation         | Choose and schedule offered Activity IDs                                                                                                                 | Create entities                                                         |
| Verification                 | Drop hallucinated IDs, duplicates, invalid subsets, and infeasible schedules                                                                             | Trust prompt compliance                                                 |

Here, **diversity means marginal non-redundancy within the selected set**, not
random variety. Set-level selection rewards an uncovered requested theme or
requested experience format and softly penalizes near-duplicate semantic
content or excessive repetition of one normalized subtype. It must not spread
stops across the city, require every Activity kind/provider, or select a weaker
irrelevant place merely to satisfy a quota. Geographic coherence remains a
separate feasibility constraint, and food/drink cadence remains the deferred
role-aware design below.

Destination resolution must not assume that the frontend display label is a
canonical Nominatim query. For example, the provider label `Montevideo,
Montevideo Department, Uruguay` can return no Nominatim result while the
structured locality/country query `Montevideo, Uruguay` resolves the real city
relation. A bounded fallback must be built from structured destination
components and disambiguated with the selected coordinates and country; it
must not remove arbitrary comma-separated components and accept the first
result blindly. A non-empty forward response is not proof of a valid match:
if all returned POIs/buildings are geographically inconsistent with the
coordinates selected in the wizard, the flow treats the label as ambiguous
and runs the same reverse normalization. A selected address or specific POI
remains point-scale and does not trigger city exploration.

That last distinction cannot depend only on Nominatim successfully recognizing
the same fine-grained entity. The autocomplete provider already knows whether
the user selected a settlement or a specific POI/address, but the current
frontend drops that structured type and sends only label, coordinates, and
radius. The canonical intent contract must preserve a provider-neutral
destination-scale hint. A verified point hint prevents reverse normalization
from silently widening a selected address/POI into a city; a settlement hint
still requires coordinate-validated Nominatim identity and authoritative OSM
boundary hydration. Neither hint supplies trusted boundary geometry.

Accommodation discovery and lodging recommendations are outside the current
product scope. Lodging provider types must not become tour Activities merely
because they are returned by a broad Places query; they require an explicit
future product decision and a separate role in the domain.

## Deferred design topic: food and drink stops

Food and drink venues need role-aware scheduling; they must not be treated as
interchangeable sightseeing POIs. This is intentionally deferred until the
provider, catalog-quality, discovery, and mobility foundations are stable.

The later design must distinguish at least:

- a general or mixed tour, where a meal, coffee, or snack is a schedule-support
  stop and repeated consecutive venues are normally invalid; and
- an explicitly food-centric experience, such as a tapas, market, tasting, or
  cafe walk, where multiple verified food venues are the primary experience.

Merely including `food` among several wizard interests must not automatically
make a tour food-centric. The design also needs to account for meal windows,
opening hours, duration, budget and dietary constraints, geographic coherence,
and the user's explicit intent. Route optimization must preserve those roles
and schedule constraints rather than globally reordering all selected
Activities only by geographic distance.

The Granada regression case—three cafe/coffee venues selected consecutively in
a mixed history, food, culture, and architecture tour—must become an acceptance
fixture when this work is implemented. No ad-hoc per-type cap is part of the
current provider/cache stabilization scope.

## Deferred design topic: city-and-surroundings excursions

The first engine iteration deliberately treats an authoritative city boundary
as a hard eligibility constraint. This prevents a broad provider query or a
semantic match from pulling unrelated distant Activities into an urban tour.
It also means that important regional experiences outside the municipality are
not yet eligible. For example, a San Juan city tour can legitimately omit the
Dique de Ullum even though it may be an important experience for a visitor to
the wider destination.

This must be implemented as an explicit later product capability, not by
silently enlarging every city radius or weakening destination containment:

```mermaid
flowchart TD
    U["Wizard destination + scope preference"] --> S{"Requested scope"}
    S -- "City only" --> C["Authoritative city boundary<br/>urban candidate pool"]
    S -- "City and surroundings" --> R["Regional excursion envelope<br/>mode-aware maximum travel time"]

    R --> D["Catalog first + grounded regional gaps<br/>for sourced excursion concepts"]
    D --> E["Resolve exact POI/AREA/ROUTE identity<br/>Places + OSM with regional context"]
    E --> T["Verify outbound travel + activity duration<br/>+ return travel inside a day"]
    T --> G["Build a regional cluster or excursion<br/>never one unexplained remote outlier"]

    C --> P["Urban daily-set selection"]
    G --> P
```

The later wizard contract must distinguish `city only` from `city and
surroundings` and capture a maximum acceptable excursion travel time or an
equivalent half-day/full-day preference. Eligibility must use deterministic
travel time for the user's allowed modes; embeddings may rank a resolved
regional Activity by theme, but cannot authorize crossing the urban boundary.

Activities remain reusable geographic entities and are not duplicated for
each nearby city. The tour-generation context decides whether an Activity is
inside the urban core or is a reachable regional excursion. A remote Activity
should normally enter the schedule as a coherent excursion/cluster with
outbound and return legs, not as an isolated POI mixed into an otherwise urban
day.

This capability is intentionally scoped for future iteration.
The tour intent contract, grounded proposal and resolution boundaries,
and daily planning travel-time contracts are prerequisites, but none should
pretend to support regional excursions until the separate acceptance criteria
are implemented.

## Embeddings in the engine

Embeddings participate in retrieval, coverage analysis, semantic deduplication,
and unified ranking. They measure semantic relevance; they do not determine
whether a group of Activities can be visited efficiently.

```mermaid
flowchart TD
    U["Wizard input"] --> UI["Canonical semantic intent<br/>interests + themes + desired experience style"]
    UI --> B1["Embedding provider"]
    B1 --> QE["Query embedding"]

    U --> HARD["Structured constraints<br/>destination, budget, accessibility,<br/>opening hours, days"]
    U --> MOB["Mobility profile<br/>walking / cycling / driving / transit<br/>pace + allowed mode changes"]

    A["Persisted or updated Activity"] --> SD["SemanticActivityDocumentBuilder"]
    SD --> B2["Embedding provider"]
    B2 --> AE["Activity embedding"]
    AE --> PG[("PostgreSQL + pgvector")]
    QE --> PG

    HARD --> RET["Hybrid candidate retrieval<br/>hard eligibility + semantic relevance"]
    PG --> RET
    PG --> DUP["Semantic duplicate detection<br/>within the resolved destination"]
    PG --> RANK["Individual relevance scores<br/>interest similarity + quality"]

    RET --> SPATIAL["Transport-aware set selection"]
    RANK --> SPATIAL
    MOB --> MATRIX["Mode-aware travel-time matrix"]
    MATRIX --> SPATIAL
    SPATIAL --> TOUR["Feasible candidate groups per day"]
    SPATIAL --> COV["CoverageAnalyzer<br/>relevant and visitable matches<br/>per requested theme"]
    COV --> DECIDE{"Run discovery?"}
    DUP --> REUSE["Reuse or persist"]
```

Hard constraints run before semantic scoring: destination boundary/radius,
archive status, allowed Activity kinds, and deterministic budget,
accessibility, or operating constraints. This prevents a semantically similar
Activity in the wrong city from entering the pool. Transport mode is not text
to append to the embedding as a substitute for routing; it creates concrete
travel-time and feasibility constraints after relevant candidates are found.

All providers must embed the same canonical Activity document. For a composite
it should include verified name, kind, themes, area, duration, and waypoint
names/types. Coordinates, external IDs, ratings, and review counts are separate
identity, geographic, and quality signals and do not belong in semantic text.
Group and pace belong in the semantic document only when the Activity document
contains corresponding suitability information. Otherwise they remain
structured selection and scheduling signals.

Regenerate an Activity embedding when its semantic content changes. Embeddings
must not decide destination identity, Google/OSM identity, or anti-hallucination
verification.

## Amazon Bedrock's current role

Zig-Zag uses Amazon Bedrock as an embedding provider in production, not as the
chat or discovery provider. Titan Text Embeddings V2 produces the vectors
stored in PostgreSQL. Chat and itinerary generation remain behind the separate
OpenAI/Groq/Ollama abstraction.

```mermaid
flowchart LR
    INPUT["User intent"] --> INTENT["Canonical intent document"]
    ACT["Verified Activity"] --> DOC["Semantic Activity document"]

    INTENT --> TITAN["Amazon Bedrock<br/>Titan Text Embeddings V2"]
    DOC --> TITAN
    TITAN --> VECTORS["256-dimensional vectors"]
    VECTORS --> PG[("PostgreSQL + pgvector")]

    PG --> RETRIEVAL["Semantic retrieval"]
    PG --> COVERAGE["Coverage analysis"]
    PG --> DEDUPE["Semantic deduplication"]
    PG --> RANKING["Unified ranking"]
    RANKING --> FEASIBILITY["Transport-aware spatial feasibility<br/>separate deterministic stage"]

    DISCOVERY["Grounded discovery provider<br/>separate abstraction"] --> PROPOSALS["ActivityProposal[]"]
    PROPOSALS --> RESOLUTION["Google Places + OSM resolution"]
    RESOLUTION --> ACT
```

Vectors from different embedding models are not interchangeable even if their
dimensions match. Track provider/model/version and rebuild the full index when
switching models. Do not silently mix Titan and OpenAI/Ollama vectors.

`EMBEDDING_PROVIDER` is authoritative. An embedding-provider failure must
never select another provider automatically, regardless of which API keys are
present. The engine may retry the same provider under a bounded policy; if it
still fails, embeddings become explicitly unavailable for that operation and
retrieval degrades to the documented non-semantic signals. Changing provider
or model is an operator action followed by a complete index rebuild.

Local development uses Ollama with `nomic-embed-text`; production uses Bedrock
Titan. Both store vectors in PostgreSQL with pgvector. ChromaDB is not part of
the current architecture. Local Ollama tests validate the pipeline but do not
claim numerical parity with Titan.

The Prisma column is currently vector(256). Production configuration must stay
at 256 dimensions unless a schema migration and complete index rebuild happen
together.

### Current embedding/retrieval implementation checkpoint

Semantic retrieval is implemented as follows:

- `SemanticActivityDocumentBuilder` is the only document builder used by
  Activity embedding writes. It includes verified semantic fields and
  composite waypoints, while excluding coordinates, provider IDs, ratings, and
  review counts.
- Each stored vector carries provider, model, dimensions, document version,
  and generation time. Similarity queries use only an exact match with the
  configured index identity; legacy or mixed vectors are explicitly missing.
- `EMBEDDING_PROVIDER` is strict. Bedrock, Ollama, and OpenAI failures produce
  an unavailable state and never activate another provider.
- The current application rejects any configured vector width other than 256.
  A failed full rebuild clears its partial batches, so a provider/model switch
  cannot leave an incomplete index presented as authoritative.
- Catalog retrieval first builds the geographically eligible pool (bounded at
  250 rows for the current request path), then runs pgvector across that pool,
  and only afterwards selects the 15 candidates offered to the itinerary LLM.
  This replaces the old rating-top-20-then-embedding order.
- Measured semantic candidates compete on relevance plus bounded quality,
  proximity, kind, and subtype non-redundancy signals. Candidates without a
  compatible embedding remain an explicit unknown tier ordered by quality and
  proximity; they are not assigned a synthetic zero similarity.
- The bitacora records `not_requested`, `applied`, or `unavailable` from the
  actual similarity operation, together with eligible, compatible-indexed, and
  offered counts.

The 250/15 bounds are operational limits, not coverage policy. `CoverageAnalyzer`
replaces any raw minimum-count refill decision, while the candidate selection window
and daily planning solver own set-level diversity and deterministic transport feasibility.
Semantic retrieval does not claim that semantic relevance alone proves a day is
geographically realizable.

## Transport-aware spatial feasibility

Semantic ranking answers whether one Activity matches the user's interests.
Spatial feasibility answers whether a set of matching Activities forms a good
tour. This is a set-level decision: distance from each Activity to the
destination center is not enough because the travel cost between Activities
determines the actual itinerary.

```mermaid
flowchart TD
    C["Semantically relevant Activities<br/>verified coordinates + duration + hours"]
    T["Wizard transportationMode[]<br/>walking / cycling / driving / public_transport"]
    P["Travel pace + days + daily time budget<br/>group and accessibility constraints"]

    T --> M["MobilityProfileBuilder"]
    P --> M
    C --> TM["Pairwise travel-time matrix"]
    M --> TM

    TM --> CL["SpatialFeasibilityAnalyzer<br/>build viable clusters per day"]
    C --> CL
    CL --> SEL["Set-level selection<br/>semantic coverage + quality + diversity<br/>minus travel and mode-change cost"]
    SEL --> ROUTE["Per-day route optimization<br/>using allowed modes"]
    ROUTE --> VAL{"Within leg and daily<br/>travel budgets?"}
    VAL -- Yes --> OUT["Feasible candidate groups<br/>for itinerary generation"]
    VAL -- No --> RETRY["Reselect, split across days,<br/>or reduce stops"]
    RETRY --> SEL
```

The matrix should represent travel time and operational friction, not only
straight-line distance:

| Mode               | Required signals                                                                       |
| ------------------ | -------------------------------------------------------------------------------------- |
| `walking`          | Pedestrian route, crossings, slopes, accessibility, maximum leg and daily walking time |
| `cycling`          | Cycle-suitable route, bicycle infrastructure, slopes, parking, maximum riding time     |
| `driving`          | Road route, expected traffic, parking location, parking/search overhead                |
| `public_transport` | Stops, schedules/frequency, waiting, transfers, and walking access/egress              |

OSM and Overpass do not themselves calculate these routes. Overpass is the
read-only OSM data-query backend; an OSM-backed `TravelTimeProvider` requires a
routing engine such as OSRM, Valhalla, GraphHopper, or another reviewed
adapter. Likewise, do not model public transport as one Google
`optimizeWaypointOrder` call: Google Routes transit requests do not support
intermediate waypoints. The MVP may use supported pairwise transit legs or an
explicit conservative estimate and then hand live navigation to Google Maps.
References: [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API),
[OSM routing engines](https://wiki.openstreetmap.org/wiki/Web_front_end/Routing),
and [Google transit routes](https://developers.google.com/maps/documentation/routes/transit-route).

Daily grouping is an outcome contract, not a commitment to K-Means with
`K = days`. A valid implementation must use travel-time cost, Activity
duration, daily capacity, opening hours, and start/end constraints. Similarly,
ordering is a scheduling problem rather than pure geometric TSP; the shortest
coordinate order can still be an invalid day.

When the wizard allows multiple modes, the engine may choose a mode per leg but
must penalize excessive mode changes. Thresholds must derive from travel time,
pace, day duration, and destination context rather than one global kilometer
radius.

Coverage analysis runs after this stage. Twenty strong semantic matches can
still mean insufficient coverage when only three form a viable walking cluster.
For multi-day tours, coverage should be expressed as one or more coherent
geographic groups per day. Discovery is triggered only for themes or quantities
missing from those feasible groups, not merely because candidates are spread
across the destination.

### Accepted MVP transport contract

For the first transport-aware version, every transition between consecutive
Activities should expose this minimum snapshot:

```text
fromActivityId
toActivityId
transportMode: walking | cycling | driving | public_transport
estimatedDurationMinutes
distanceMeters
```

The existing `TourActivity.travelTimeToNext` and `distanceToNext` fields already
represent part of this transition. The smallest schema evolution is an explicit
`transportModeToNext`. A separate `TourLeg` model is deferred until the product
needs multimodal sublegs, route geometry, transfers, provider metadata, or
detailed route snapshots.

```mermaid
flowchart LR
    A["Activity A"] --> L["Zig-Zag leg snapshot<br/>selected mode + estimated time<br/>+ distance"]
    L --> B["Activity B"]
    L --> CTA["Open in Google Maps"]
    CTA --> LIVE["Live navigation<br/>current transit lines, stops,<br/>transfers and disruptions"]
```

Zig-Zag remains responsible for deciding that the leg fits the schedule and
uses a mode allowed by the user. For `public_transport`, the UI may show
"public transport, approximately 35 minutes" and open Google Maps with origin,
destination, transit mode, and, when available, the intended departure time.
The MVP does not persist a bus/subway line, stop sequence, transfer instructions,
turn-by-turn directions, or a detailed polyline. Those details are volatile and
belong to the live navigation provider.

Travel time must come from deterministic routing when available, not from an
LLM. If the first release lacks reliable public-transit routing, show a clearly
approximate conservative range, reserve the upper bound in the schedule, and
delegate the live route to Google Maps. Navigation is delegated; itinerary
feasibility is not.

### Current implementation checkpoint and remaining gap

The wizard now submits one typed contract containing allowed transportation
modes, interests, desired experience formats, exploration style, a per-day
walking budget, maximum continuous walking leg, pace, accessibility, and
bounded additional preferences. The normalized contract is persisted and the
bitacora reports those values as captured. Deterministic post-processing does
not yet implement the target mobility architecture above.
[route-optimizer.util.ts](../../be/src/modules/tours/utils/route-optimizer.util.ts)
uses nearest-neighbor plus 2-opt over straight-line Haversine distance for every
request, and
[travel-time-calculator.util.ts](../../be/src/modules/tours/utils/travel-time-calculator.util.ts)
assumes walking at 5 km/h and stops calculating at a 2 km leg. It can reorder
selected stops but cannot reject, replace, cluster, or route them differently
for cycling, driving, or public transport. Treat this section as required
design input before extending candidate selection or route optimization;
consult the code for the current implementation state.

### Persisted draft versus user confirmation

Asynchronous generation requires a persisted Tour ID before activities can be
generated, so persistence itself is not user confirmation. The current schema
tracks generation progress but has no independent lifecycle state; the review
button only applies composite-waypoint edits and navigates to detail. A separate
increment must introduce a domain lifecycle such as `DRAFT | CONFIRMED |
ARCHIVED`, show review for every generated tour, expose an explicit confirm
operation, and keep drafts separate from confirmed saved tours. Future prompt
edits should operate on a draft revision rather than silently mutate a
confirmed historical snapshot.

## Places acquisition: Text Search primary, Nearby coverage secondary

This section is a **zoom into the Places acquisition node of the end-to-end
flow**. It does not introduce a mandatory crawl on every request. Its output
returns to `Persist and deduplicate real POIs`, followed by catalog re-query,
semantic/spatial analysis, and coverage evaluation.

Places acquisition has two independent needs: retrieve relevant visitor POIs
from an intent-driven Text Search and, only for an explicit remaining type/zone
gap, cover part of a city polygon with bounded point-based Nearby operations.
Google Places is the selected MVP provider; Geoapify remains an explicitly
selected adapter, not an automatic fallback. Provider capabilities remain
visible rather than being forced into equivalent-looking calls.

```mermaid
flowchart TD
    A["Resolved destination context<br/>boundary + locality + country<br/>selected point"]
    A --> S["Destination seed<br/>Google Text Search only when configured<br/>tourism-oriented controlled queries"]
    A --> B["CatalogRefillAnchorPlanner<br/>destination point first<br/>+ spatially distributed real-area centers"]

    B --> N["Geographic coverage<br/>Nearby Search per bounded anchor<br/>primary type groups + popularity"]
    S --> D["Union normalized provider results"]
    N --> D

    D --> E["Hard operation geography<br/>circle/rectangle + exact destination polygon"]
    E --> F["Deduplicate<br/>provider + external ID"]
    F --> V["CatalogIdentityValidator<br/>identity + coordinates + status + type"]
    V --> Q["CatalogAdmissionPolicy<br/>review confidence or corroborated institution"]
    Q --> G["Persist admitted real POIs<br/>with provider evidence"]
    G --> H["Generate Activity embeddings"]
    H --> I["Re-query catalog<br/>rerun semantic and spatial feasibility<br/>then rerun coverage"]
```

This Places zoom ends at catalog reevaluation. It does not enumerate OSM
neighborhoods or create a composite. A missing walk/route/experience becomes a
typed coverage deficit and enters the grounded-proposal resolver shown in
[OSM composite resolution](#osm-composite-resolution).

An anchor is an implementation point for calling a point-based API. It is not a
new domain entity and is not persisted as an Activity. Point-scale destinations
use their own point as the single anchor; area-scale destinations use a bounded
number to control latency, quotas, and cost.

For an area-scale destination, the selected destination point is the first
anchor when it lies inside the boundary. Remaining anchors are selected from
structurally valid real child-area centers by a named, deterministic spatial-
coverage algorithm. Four to eight total anchors is a target only when that many
authoritative points exist. The engine does not fabricate grid points or use
alphabetical/relevance ordering to reach a quota. An anchor means API coverage;
it never means that its neighborhood is touristic or selected for a composite.

### Provider-operation zoom inside catalog acquisition

The following diagram is a second-level zoom into the seed and geographic-
coverage operations. Text Search is an explicit acquisition operation, not a
fallback after Nearby failure.

```mermaid
flowchart TD
    PLAN["Typed CatalogAcquisitionPlan<br/>purpose + operation + geography + budget"] --> C{"Explicitly selected<br/>Places provider"}

    C -- Google seed --> T["Google Text Search<br/>controlled destination query<br/>singular includedType when applicable<br/>explicit strictTypeFiltering<br/>rectangle restriction or bounded bias"]
    C -- Google coverage --> N["Google Nearby Search<br/>includedPrimaryTypes groups<br/>POPULARITY + hard circle"]
    C -- Geoapify coverage --> G["Geoapify category search<br/>mapped categories + hard circle"]
    C -- "Geoapify + Google-only seed" --> SKIP["Capability unavailable<br/>trace skipped/degraded<br/>never fake free-text equivalence"]

    T --> J["Normalized result<br/>primary type + types + provider fields<br/>typed operation provenance"]
    N --> J
    G --> J

    J --> K["Hard operation geography<br/>then exact destination boundary"]
    K --> M["Union seed + coverage results"]
    M --> D["Deduplicate<br/>provider + external ID"]
    D --> I["Identity validation"]
    I --> Q["Admission evidence policy"]
    Q --> O["Persist admitted new real POIs"]
    O --> P["Return to end-to-end flow<br/>re-query catalog"]
```

Operation semantics are deliberately not presented as equivalent:

- Google `searchNearby` is the geographic-coverage operation for conventional
  typed POIs. Catalog refill uses controlled `includedPrimaryTypes` groups and
  `POPULARITY`; its provider request enforces a circle.
- Google `searchText` provides the configured destination-level tourism seed.
  It uses structured locality/country context and a rectangular restriction
  where supported. Every result still receives the exact backend destination-
  polygon check.
- Google Nearby `includedPrimaryTypes` and Text Search's singular
  `includedType`/`strictTypeFiltering` are different contracts. The provider
  interface and trace preserve that difference. `strictTypeFiltering=false`
  does not mean that `includedType` is harmless: Google documents that
  categorical queries almost always apply the type filter. Broad visitor or
  mixed-theme queries therefore omit `includedType` and carry a separate
  explicit list of admissible returned primary types; a narrow one-type query
  may use it.
- Geoapify Places has no equivalent descriptive free-text Places endpoint. A
  Google-only destination seed is skipped visibly when Geoapify is selected;
  category mappings remain category operations, not fake Text Search.
- Exhausting or failing Nearby does not cause the same request to be retried
  through Text Search, and provider failure does not automatically switch
  Google to Geoapify. Independent configured operations may still produce a
  truthful partial result.
- Seed and coverage operations share one explicit total call/time/result
  budget. After reserved seed operations, the scheduler distributes grouped
  primary-type operations fairly across requested categories and anchors.
- If no valid candidate remains, any provider quota, rate-limit, strict-cache,
  or availability failure must remain visible; the engine must not rewrite it
  as "the destination has no places."

### Catalog candidate validation contract

The catalog write gate coordinates `CatalogIdentityValidator` and
`CatalogAdmissionPolicy`. Free-form LLM output never passes through this path
and cannot be persisted as a POI. Identity validation establishes that the
provider entity is structurally usable; admission requires enough evidence for
it to enter Zig-Zag's reusable catalog. Admission does not guarantee later tour
eligibility, which belongs to the read-side coverage quality gate (`CoverageAnalyzer`).

| Rule                        | Rejection reason                      | Exact meaning                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-empty normalized name   | `empty_name`                          | Unicode accents, case, punctuation, and repeated whitespace are normalized before checking.                                                                                                                                                                                                                                                                                                     |
| Non-generic identity        | `generic_name`                        | Exact placeholder-like names such as `Arquitectura`, `Edificio`, `Monumento`, `Point of Interest`, `Unnamed Road`, or `Sin nombre` are not useful catalog entities. A real specific name containing one of those words is not rejected by this rule.                                                                                                                                            |
| Provider identity           | `missing_provider_id`                 | A stable Google Place ID or Geoapify place ID is required so the same real entity can be deduplicated and traced.                                                                                                                                                                                                                                                                               |
| Valid coordinates           | `invalid_coordinates`                 | Latitude and longitude must be finite and inside the legal WGS84 ranges.                                                                                                                                                                                                                                                                                                                        |
| Operation geography         | `out_of_area`                         | Nearby results must be inside their hard anchor circle. Destination-seed Text results must satisfy their configured rectangle when used. Every area-scale result also receives the exact destination-polygon check. Provider bias alone is never trusted.                                                                                                                                       |
| Destination boundary        | `outside_destination_boundary`        | For an area-scale destination, the point must also be inside the authoritative Polygon or MultiPolygon, including hole handling. A high rating does not override this rule.                                                                                                                                                                                                                     |
| Operating status            | `permanently_closed`                  | Reject only provider statuses meaning that the business ceased operating permanently: Google `CLOSED_PERMANENTLY` or its normalized equivalent `PERMANENTLY_CLOSED`. This does **not** mean closed now, outside opening hours, a holiday, or a temporary closure. Schedule feasibility is a later tour-planning concern, not catalog identity validation.                                       |
| Supported semantic type     | `unsupported_type`                    | At least one provider type must map to a supported catalog POI type such as museum, landmark, place of worship, park, food venue, or entertainment venue.                                                                                                                                                                                                                                       |
| Supported primary type      | `unsupported_primary_type`            | Google admission requires the returned `primaryType` to match a controlled catalog mapping for the acquisition operation. A requested type or unrelated secondary type is not enough. Provider adapters without an equivalent primary type use their own explicit policy.                                                                                                                       |
| Internally consistent types | `conflicting_provider_types`          | A supported primary type is rejected when additional structured provider types contradict that identity under a narrow documented rule. Examples: `church`/`place_of_worship` combined with `school`/`educational_institution`, or generic `park` combined with `campground`/`lodging`, do not enter the corresponding visitor pool. This is type-based and does not use place-name blacklists. |
| Not an address feature      | `address_only`                        | Results whose types are only street address, route, premise, postal code, intersection, neighborhood, locality, administrative area, or country are not materialized as POIs. OSM streets and areas follow the composite-activity path instead.                                                                                                                                                 |
| Review-backed admission     | `insufficient_review_confidence`      | A Google candidate using the review-evidence path must pass the explicit category policy. A perfect rating backed by one review is not sufficient. Policy parameters are centralized, traced, and tested at their boundaries.                                                                                                                                                                   |
| Institutional admission     | `missing_institutional_corroboration` | A supported institutional primary type without sufficient review confidence requires structured corroboration such as an official website, phone, or opening hours. A `museum`/`church` type alone is not evidence.                                                                                                                                                                             |
| Provider-specific admission | `insufficient_provider_evidence`      | A provider without Google-equivalent review/primary-type data follows its own documented evidence contract. It must not inherit Google's fields or silently pass every mapped category.                                                                                                                                                                                                         |

Google review-confidence boundaries are centralized and inclusive:
visitor landmarks `4.0/50`, museums and arts `4.0/20`, outdoor `4.1/50`, food
and nightlife `4.2/100`, and entertainment `4.0/100` (rating/review count).
Missing ratings are not interpreted as zero; they must use an applicable
corroborated-institution or provider-specific evidence path instead. These are
write-admission boundaries, not tour-ranking weights.

Deduplication by `provider + external ID` happens after the operation-specific
circle/rectangle check and before identity validation. A duplicate contributes
`duplicate_result`; an already persisted valid entity contributes
`existing_activity`. Neither is a new catalog row. Operational conditions such
as `provider_request_failed` and `refill_budget_exhausted` describe acquisition
degradation, not bad places, and therefore remain separately visible.

The generation trace reports the stages with deliberately different counters:

- `seedReceived` / `coverageReceived`: raw results by acquisition purpose;
- `deduplicated`: repeated provider identities removed after the union;
- `identityValid`: unique candidates that passed structural identity rules;
- `admitted`: identity-valid candidates that passed an evidence path;
- `persisted`: admitted candidates that were actually new rows;
- `embedded`: newly persisted Activities whose embedding write succeeded;
- `rejectedCountByReason`: the reasons above, including operational reasons.

One candidate can have multiple identity/admission reasons, so the sum of the
per-reason counters may exceed the number of rejected candidates. A failed
embedding is reported truthfully and does not pretend that semantic ranking
was available. Legacy rows already present in a disposable local database are
not proof that the write gate failed: the admission write gate prevents new invalid persistence;
the later read-side eligibility gate handles pre-existing catalog data.

The development bitacora must render the non-request-failure entries from
`rejectedCountByReason` using their canonical codes; it must not tell a reader
to consult details that the UI and copied trace do not expose. Provider request
failures remain a separate operational count. Offered catalog candidates also
show their provider primary type and Zig-Zag catalog category when available,
so a real but unexpectedly ranked item can be audited without guessing from
its name. Destination resolution describes an authoritative city boundary as
the scope for retrieval/acquisition; it must not claim that neighborhoods were
explored unless a later targeted proposal-resolution stage actually did so.

### Exact OSM membership inside proposal resolution

Coverage-anchor centers are not polygons and cannot prove that a catalog POI
lies inside a neighborhood. Only after Discovery or an existing reusable family
names a finite real area may the proposal resolver use a bounded Overpass batch
to evaluate its candidate points against authoritative boundaries:

- no matching child area is `unresolved`, not evidence of zero quality;
- more than one matching child area is `ambiguous` and is not assigned;
- provider or contract failure is `unavailable` and cannot trigger an
  alphabetical or nearest-centroid fallback;
- one matching expected area provides membership evidence for that concrete
  proposal only; it does not rank the area against every barrio in the city.

The resolver hydrates the proposed area's real Polygon/MultiPolygon by OSM ID
and runs detailed calls only inside that finite scope. Google POIs can become
composite waypoints only through exact, unambiguous membership; coordinate
checks against lightweight OSM centers are forbidden. This adapter is delivered
with the proposal resolver, not earlier as unused infrastructure.

```text
Catalog Refill finds conventional real POIs through Google Places.
Activity Discovery proposes higher-level experiences missing from the catalog.
```

## Coverage decision

Coverage is not a single candidate count. It should report:

- usable quantity for requested days and pace;
- strong semantic matches for every requested interest;
- Activity kind diversity;
- transport-feasible candidate groups for each day;
- per-leg and per-day travel-time budgets for the allowed modes;
- destination distribution without forcing unrelated distant clusters into one day;
- quality/confidence;
- destination-knowledge state: profiled and fresh, stale, or unprofiled;
- missing themes and kinds to request from discovery.

For an already-profiled destination, Discovery receives only missing coverage.
For a new or stale destination it may produce one bounded profile/bootstrap
even when the raw catalog count is high; Santa Fe demonstrated that 51 Places
rows can still omit most obvious visitor landmarks. It must not rediscover an
entire healthy destination for every tour.

### Grounded destination bootstrap and qualitative-gap discovery

This stage belongs to the
provider-neutral Activity Discovery pipeline. It is not an always-first provider:
it runs for an unprofiled/stale destination or a concrete qualitative,
must-see, theme, neighborhood, or experience gap. A conventional named POI can
go directly to Places resolution without grounded discovery.

**Implementation:** discovery is two separate
providers, not one combined step. A `GroundedSearchProvider` gathers real
search evidence first (`GroqGroundedSearchService` — Groq's `browser_search`
tool — or the current default, `SerpApiGroundedSearchService`, a plain Google
Search API decoupled from the extraction model's own token/rate quota); only
if that step reports `groundingStatus: 'applied'` does a
`SearchGroundedDiscoveryProvider` (`GroqDiscoveryProvider`) run structured
extraction over the supplied evidence. The extraction step may never invent
evidence: `ActivityProposal.evidenceKeys` and each `EntityHint.evidenceKeys`
reference only keys the search step actually returned, checked at both
granularities before a proposal is accepted.

```mermaid
flowchart TD
    CAT["Catalog query + destination knowledge state"] --> COVER{"Profile fresh and requested<br/>coverage sufficient?"}
    COVER -- Yes --> POOL["Reuse verified catalog pool"]
    COVER -- "No: new/stale or qualitative gap" --> DISC["ActivityDiscoveryService<br/>bounded profile or explicit deficits"]
    DISC --> SEARCH["GroundedSearchProvider<br/>real search evidence (SerpApi / Tavily)"]
    SEARCH -- "not applied" --> EMPTY["No proposals — never fabricated"]
    SEARCH -- applied --> GROUND["SearchGroundedDiscoveryProvider<br/>structured extraction (Groq / Gemini)"]
    GROUND --> PROP["Structured ActivityProposal[]<br/>POI / ROUTE / WALK / EXPERIENCE<br/>evidenceKeys + entityHints"]
    PROP --> RESOLVE["1. Entity resolution<br/>Places for POI/venue<br/>OSM for area/route/path"]
    RESOLVE --> GEOVALID["2. Geographic validation<br/>Deterministic coherence, cluster radius & bounding"]
    GEOVALID -- Rejected --> DROP["Reject proposal with stable reason code"]
    GEOVALID -- Accepted --> MATERIALIZE["3. Catalog materialization<br/>Atomic persistence of activities/families/waypoints"]
    MATERIALIZE --> REQUERY["Requery catalog & merge into candidate pool"]
    REQUERY --> POOL
```

### Tripartite Proposal Pipeline

Discovered proposals transition across three strictly isolated stages:

1. **Entity Resolution (`ActivityProposalResolutionService`)**: Maps LLM-generated `entityHints` to real provider records (Places, OSM). This stage does not evaluate spatial coherence, kind rules, or persist records.
2. **Deterministic Geographic Validation (`CompositeGeographicValidationService`)**: Applies pure deterministic checks (bounding box, cluster radius, minimum component counts, route continuity) based on the proposal kind (`NEIGHBORHOOD_WALK`, `ROUTE`, `EXPERIENCE`).
3. **Catalog Materialization**: Only `GEO_VERIFIED` proposals are persisted to the database in an atomic transaction, generating canonical Activity IDs and triggering asynchronous media enrichment.

### Transactional Outbox and Asynchronous Media Architecture

- **Transactional Initiation:** `TourGenerationService.createTourFromWizard` creates the tour in `pending` state and atomically enqueues a `TourGenerationRequested` outbox event in the same database transaction. `TourGenerationProcessorService` consumes the event to execute generation.
- **Consumer Policy:** `InMemoryQueueService` enforces local subscriber registration for critical topics (`TourGenerationRequested`, `ActivityMediaEnrichmentRequested`). If no handler is registered, an error is thrown to keep the event retryable in the outbox loop. Optional topics (e.g. `ActivityMediaUpdated`) are acknowledged as no-ops.
- **Asynchronous Media Enrichment:** Media lookup (Wikimedia Commons / geosearch) runs purely in the background via `ActivityMediaEnrichmentRequested` and emits `ActivityMediaUpdated`. Media enrichment never blocks tour generation, planning feasibility, or tour completion.

The grounded provider may propose `San Telmo`, `La Boca`, or `Recoleta`, but
those strings have no geographic authority. `Montserrat` versus OSM
`Monserrat` requires an explicit alias/fuzzy-name resolution constrained to
the destination. A phrase such as `downtown area`, an out-of-city homonym, or
an invented neighborhood is rejected unless it resolves unambiguously to one
of the OSM boundaries already offered. Raw model text is trace evidence only;
it is never persisted as an `AREA`, geometry, external ID, or catalog prose.

## Activity proposal boundary

A provider-neutral proposal is not a persisted Activity. At minimum it carries:

```text
name
kind: POI | ROUTE | NEIGHBORHOOD_WALK | EXPERIENCE
themes[]
suggestedDurationMinutes
shortReason
entityHints[]     // each hint: key, name, role, expectedType, required, evidenceKeys[]
evidenceKeys[]    // keys into the search provider's evidence map
```

Entity hints use stable keys and controlled role/expected-type vocabularies.
AREA is resolution context rather than a recommendable proposal kind. POI
proposals are supported because grounded recommendation can identify missing
must-see entities; each still requires exact Places resolution before it can
be persisted.

Evidence is owned by the search provider, never the extraction step:
`evidenceKeys` at both the proposal level and the individual `entityHints[]`
level reference that provider-supplied map — a required hint with no
evidence, or one citing a key the search step never returned, rejects the
proposal. The extraction step may cite evidence; it may never invent a
snippet, source, or URL of its own.

The short reason and raw provider output belong in the generation trace for
auditability. They must not be copied directly into persisted catalog prose.

## Change checklist

Before merging a change to this engine, verify:

- Does catalog retrieval still run before discovery?
- Are point-scale and area-scale destinations explicit?
- Are geography and identity authoritative rather than semantic?
- Can every persisted coordinate, geometry, and external ID be traced?
- Is discovery provider-neutral and free of Prisma dependencies?
- Does CoverageAnalyzer request only missing coverage?
- Does coverage represent feasible per-day groups rather than a raw count?
- Are themes, desired experience formats, allowed transport modes, pace, daily
  walking distance, and continuous walking-leg limits represented separately?
- Are embeddings generated from the canonical semantic document?
- Are embedding provider/model/version consistent with the index?
- Does `transportationMode` drive deterministic travel-time analysis and route
  validation instead of existing only in the LLM prompt?
- Are walking limits enforced per day and per leg without being inferred from
  “walking” as an experience format or transport mode?
- Does every persisted/displayed transition identify its selected mode and a
  defensible time estimate?
- Are live transit lines and turn-by-turn navigation delegated to the map
  provider without delegating itinerary feasibility?
- Are semantic relevance, set selection, and route ordering separate stages?
- Can an infeasible itinerary reselect, split, or reduce stops instead of being
  persisted unchanged?
- Does the planner receive only verified Experience IDs?
- Are flat and composite hallucinations rejected server-side?
- Are historical waypoint snapshots preserved?
- Are lifecycle changes explicit and restrictive?
- Was every superseded selector, branch, mock, trace label, and dependency
  removed rather than left as an unused fallback?
- Is the generation bitacora updated for new decisions and fallbacks?

> ## ✅ Current content resumes here
>
> The sections below (`Experience Domain V2 — provider boundaries` onward)
> describe the live, current architecture.

## Experience Domain V2 — provider boundaries

The V2 migration makes `Experience` the only schedulable tourism unit and
keeps `GeoEntity` as the representation of physical reality. The provider
boundaries are intentionally explicit:

```mermaid
flowchart TD
  I[User intent] --> C[Local Experience catalog]
  C -->|coverage gap| T[Tavily grounded search]
  T --> L[LLM preference interpretation / evidence extraction]
  L --> R[GeoEntity resolution]
  R --> P[Places: PLACE entities]
  R --> O[OSM Overpass/Nominatim: AREA and ROUTE entities]
  P --> V[Deterministic evidence + geographic validation]
  O --> V
  C --> V
  V --> D[Conservative dedupe]
  D --> E[Persist VERIFIED Experience]
  E --> K[Rank and candidate window]
  K --> S[Deterministic daily solver]
  S --> X[Internal/external routing]
  X --> Y[TourExperience snapshots]
```

`ExperienceAcquisitionService` is the reusable acquisition boundary for
provider refills. Tour generation may invoke it after coverage analysis, but
the service does not create tours or snapshots; it only admits provider
results into the verified Experience catalog.

| Boundary | Authority and responsibility |
| --- | --- |
| Local nearby search | PostgreSQL/pgvector catalog retrieval; no external provider and no truth decision by itself |
| Google Places | Resolve a physical `GeoEntity PLACE` and its provider identity; a Nearby query is a resolver lookup, not Experience proof |
| OSM Overpass/Nominatim | Resolve `AREA`/`ROUTE`, boundaries and canonical geometry; route geometry is not generated by the planner |
| Tavily | Grounded evidence acquisition when local coverage is insufficient; never a geographic authority |
| LLM | Normalize free-text preferences and extract candidates/components from supplied evidence; never validates, deduplicates or plans |
| Geographic validation | Deterministic checks over evidence, resolved entities, destination scope and coherence |
| Daily planner | Deterministic scheduling of persisted VERIFIED Experiences only |

Routing is downstream of verification and selection. Provider-generated paths
are logistical derivations and must not be used as evidence that an Experience
exists. Outbox/queue execution remains asynchronous and durable. V2 media
enrichment uses `ExperienceMediaEnrichmentRequested` / `ExperienceMediaUpdated`
and updates the shared `Experience`; the legacy Activity media topic is not
part of the V2 generation path. The persisted Bitácora also contains an
`executionSummary` with the stage-by-stage decision narrative rendered by the
tour detail UI.
## Experience Domain V2 cutover (2026-09-02)

The current `feat/experience-domain-v2` implementation supersedes the historical Activity flow described in earlier sections of this document. The authoritative runtime path is:

```mermaid
flowchart LR
  W[Wizard intent] --> P[PreferenceInterpreter]
  P --> D[Destination boundary]
  D --> C[Verified Experience catalog]
  C --> A[Experience acquisition]
  A --> R[OSM/Places resolution]
  R --> V[Component geographic validation]
  V --> E[Evidence-backed Experience]
  E --> K[Experience ranking]
  K --> S[Deterministic daily planner]
  S --> T[TourExperience snapshots]
  T --> O[Outbox/media events]
  O --> B[Persisted Bitácora V3 + execution narrative]
```

`Activity`, `ActivityKind`, `TourActivity`, and the former format/kind coverage rules are historical terminology and are not part of the active V2 generation graph. V2 ranking is Experience-native and only applies deterministic relevance/capacity limits—there is no format or ActivityKind gate. Async generation remains durable: the HTTP request persists the Tour and outbox request first; the worker performs acquisition, resolution, validation, selection, planning, snapshot persistence, and media enrichment asynchronously. Grounded search and LLM extraction propose concepts and evidence only; OSM/Places resolution and component-level geographic validation decide whether an Experience is real.

### Current implementation checkpoints (2026-09-02)

- The active discovery boundary requires `extractExperiences`; the worker no
  longer falls back to the historical `ActivityProposal` extractor.
- The deterministic planner carries `experienceId` through selection,
  completeness, and `TourExperience` snapshot materialization. V2 generation
  does not look up planner items in `TourActivity`.
- Media notification delivery is Experience-native (`ExperienceMediaUpdated`)
  and resolves related tours through `TourExperience`.
- The local runtime is configured with Tavily for grounded search, Gemini for
  candidate extraction, Groq for the general chat provider, and the local
  Overpass instance for OSM queries.

These checkpoints are implementation evidence, not a declaration that every
historical test and document has been rewritten. The versioned migration
`20260902120000_remove_activity_domain_v2` drops the historical Activity tables
and enums idempotently after the prior migrations. It has been applied to the
local development database without deleting valid Experience or
TourExperience rows. New environments, including AWS, must run the complete
migration chain to receive the same cutover deterministically. The backend
typecheck is green; remaining frontend/type-test failures are tracked as
separate migration work rather than hidden behind compatibility aliases.

### Destination Cover Photo Asynchronous Resolution (2026-09-10)

- **Authentic Resolution via Outbox**: A Tour's presentation asset (`coverImage`) is resolved asynchronously during/after Destination Resolution via verified providers (`WikimediaPhotoProvider` / Google Places), avoiding expensive AI image generation stalls and preventing mismatched city fallbacks (e.g. Obelisco on Salta/Bariloche tours).
- **Direct SSE Delivery**: `TourProgressUpdated` carries the resolved `coverImage` directly in its payload over the SSE stream, allowing the client to transition without an extra HTTP round-trip, while simultaneously persisting `coverImage` to Postgres.
- **Frontend Skeleton Shimmer Contract**: While the tour is generating and `coverImage` is pending, `TourHeader` presents an animated skeleton shimmer (`TourHeaderSkeleton`). Upon SSE receipt, it performs a smooth fade-in to the verified destination photo. Hardcoded single-city placeholders are strictly prohibited across general fallbacks.
- **Full Spec**: See `docs/superpowers/specs/2026-09-10-destination-cover-photo-async-resolution.md`.



## Experience Domain V2 — component resolution and geographic validation amendment (2026-09-22)

The RW1 forensic rerun of 2026-09-22 supersedes the earlier all-or-nothing
`required` interpretation for composite components.

Current target flow:

```text
Experience/source evidence
        ↓
extract every evidenced component
        ↓
for each component:
  acquire/correlate candidates
  → identity decision
  → component geographic relation
        ↓
resolution coverage + research deficits
        ↓
Composite Geographic Validation
        ↓
verified canonical Experience
        ↓
traveler-facing enrichment
        ↓
ranking / deterministic planner
```

The extraction LLM does not own a `required` geographic-truth bit. A component
that cannot yet be resolved remains an explicit research deficit rather than
automatically erasing an otherwise source-backed composite.

Component geography and composite geography are separate:

- for a real AREA, point membership is based on the Polygon/MultiPolygon;
  outside points may have a measured near-boundary relation, which is not
  standalone acceptance;
- for a ROUTE, use real LineString/intersection/corridor semantics rather than
  one representative point;
- POINT_RADIUS continues to use center/radius semantics;
- composite validation decides whether the resulting INSIDE/INTERSECTS/NEAR
  relations form one coherent evidence-backed Experience.

For example, an evidenced San Telmo walk can legitimately start at Plaza de
Mayo outside the neighborhood polygon and enter San Telmo via Calle Defensa.
Strict containment of every stop would reject a real route. Conversely, mere
proximity to San Telmo does not make an unrelated place part of the walk.

Identity corroboration is additive. OSM/Nominatim/Places observations may
converge on one canonical object; this must be traced, but provider counts are
not votes. A missing/non-matching Wikidata corroboration is not by itself
positive evidence that the candidate is wrong.

The hard physical kinds remain `PLACE | AREA | ROUTE`; this amendment does not
introduce a second closed tourism semantic-type taxonomy for identity.

Full rationale and open decisions:
`docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`.

## Experience Domain V2 — catalog-first identity reuse and semantic ranking refinement (2026-09-22)

The component-resolution amendment is refined by one additional boundary:
**Zig-Zag's canonical catalog is the first identity-memory lookup for a
component, not merely the final write destination.**

Target V2 flow:

```text
source-backed Experience evidence
        ↓
component hints
        ↓
canonical GeoEntity lookup
        ↓
reuse sufficient known identity
OR
open precise external resolution deficit
        ↓
correlate provider observations + canonical knowledge
        ↓
component identity + geographic relation
        ↓
composite geographic validation
        ↓
persist/reuse canonical Experience
        ↓
Experience semantic embedding / versioned index
        ↓
preference composition + cosine similarity
        ↓
deterministic planner
        ↓
planner residual-capacity backfill
  catalog/reservoir first
  external acquisition only if still insufficient
```

### Catalog-first does not mean cache-trust

A catalog candidate is reusable only when the canonical identity facts are
sufficient, structurally compatible and not positively contradicted in the
current context. Otherwise the resolver researches the missing fact through
the applicable providers and reconciles the new observations with existing
knowledge.

External providers are therefore **deficit repair**, not mandatory
reconfirmation of every already-known physical entity on every request.

### Component resolution does not create standalone Experiences

`ExperienceComponent` continues to reference `GeoEntity` when it is
resolved. (Amended 2026-10-08: a component is one source-declared member and
may be UNRESOLVED; see "partial source compositions" at the end of this
document.)

A component verified while resolving a composite may create/reuse that
GeoEntity, but it does not create a standalone Experience as a side effect.
Standalone Experiences require their own source-backed acquisition/discovery
authority. The same GeoEntity can later be shared by the composite and any
independently discovered standalone Experience.

### Nearby/planner boundary

Geographic proximity never proves composite membership. Planner backfill may
schedule independent verified Experiences to use residual daily capacity, but
it must not rewrite the canonical component set of a source-backed Experience.

Catalog/ranked-reservoir reuse comes before external acquisition. Any acquired
Experience must pass the normal evidence → resolution → validation →
persistence path before replanning.

### Embedding boundary

Embeddings are generated for canonical Experiences and compared with the
positive `PreferenceSpec.semanticQuery` through pgvector cosine similarity.
They affect deterministic composition/reservoir order and planner soft
relevance only after canonical eligibility.

They never establish GeoEntity identity, Experience existence, component
membership, geographic validity or facet coverage.

Removing LLM-owned component `required` changes the canonical semantic
document because the current document serializes `required/optional`.
The cutover therefore requires an embedding document-version bump and reindex
of stale VERIFIED Experiences.

### Experience Domain V2 — catalog-first ownership refinement (2026-09-23)

Catalog-first component reuse is a read-side resolution boundary, not a new
identity authority:

```text
ExperienceProposalResolverService
→ ExperienceCatalogService.findGeoEntityCandidatesForHint(...)
→ candidate correlation
→ IdentityVerifier
```

The catalog service retrieves canonical candidates; correlation groups
observations that share exact/canonical identity facts; `IdentityVerifier`
alone decides whether a candidate/cluster satisfies the component hint.

The schema already has typed `GeoEntity.kind: GeoEntityKind`
(`PLACE | AREA | ROUTE`), first-class name/address/geography, and
`GeoEntityIdentity(provider, externalId)`. Do not add a duplicate kind field or
migration. Existing `upsertGeoEntity` nearby reconciliation is write-time
dedupe after provider resolution; catalog-first is read-time knowledge reuse
before provider calls. A dedicated alias model remains optional until
characterization proves it necessary.
### Experience Domain V2 — source grounding and deficit classification refinement (2026-09-22)

Catalog-first reuse does not weaken source authority. Before any component hint
can enter identity resolution, its cited SourceObservation must contain
verifiable support for the component (a structured source item or a bounded
textual support span that can be checked against the captured evidence). A
nearby real GeoEntity cannot retroactively justify an extractor hallucination.

The RW1 cold-2 `Basílica de Santa Mónica` / `ev-11` case is the regression
fixture: the component must fail at source-support admission, not later only
because no provider happened to return a matching POI.

Candidate correlation is a distinct provider-neutral stage before final
IdentityVerifier judgment:

```text
catalog candidate + provider observations
        ↓
deterministic canonical-object correlation
        ↓
candidate cluster(s) + typed evidence
        ↓
IdentityVerifier
```

Correlation owns grouping only. IdentityVerifier remains the single authority
for "does this candidate/cluster satisfy the hint?". Provider count is never a
vote.

Finally, only genuine world-knowledge ambiguity may become a Tourism Researcher
deficit. Provider/operational failure, premature acquisition termination,
source-contract violation or a misleading aggregate rejection reason are
system defects and stay outside the research-agent loop.


## Experience Domain V2 — exhaustive source-atom labelling amendment (2026-10-06)

**Status: APPROVED (owner, 2026-10-06), gated by milestones A → B → C
below.**

- Milestone A: closed as COMPLETED_WITH_FINDINGS (owner, 2026-10-06), and
  its boundary hardening (A.1–A.3) landed in the spike.
- Milestone B: **IMPLEMENTED in production (2026-10-06)** for
  `SECTION_UNIT` windows with `sectionComplete=true`; there, this contract
  is the only composition authority.
- C3 is not yet run.
- Every other window still asks the generative extractor for
  `ExperienceCandidate`s from prose.

This amendment defines the replacement contract for editorial itinerary
units and the evidence a cutover must meet. Spike:
`spikes/rw4-atom-labelling-2026-10-06/`. Finding:
RW4-EXTRACT-COMPLETENESS-1 (`spikes/rw4-extract-completeness-2026-10-05/`).

### Problem

```text
complete editorial unit → LLM generates candidate(s) → validators check what was emitted
```

The mechanical loss paths are fixed: unit windowing, early acceptance of an
incomplete window, silent `MAX_HINTS` truncation, markdown span
normalization, and a prompt without exhaustive itinerary semantics. The
remaining defect is the contract itself. A generative extractor that gets a
complete unit can still omit a required stop, merge segments that the
source separates by a transfer, or promote a passing mention. Source
support, identity, geography and `INCOMPLETE_SOURCE_COMPOSITION` judge only
emitted objects. A missing stop leaves nothing to judge. Model selection
lowers the omission rate but does not make an omission detectable.

### Target contract

```text
editorial unit
  → deterministic atomization        (no semantics)
  → LLM labels EVERY atom            (semantic authority)
  → deterministic completeness check (fail closed)
  → deterministic assembly           (order, segments, roles)
  → source support → identity → geography   (unchanged)
```

The LLM stays the only semantic authority. Deterministic code splits text and
checks structure. It never infers itinerary meaning from words. Keyword
lists, transport dictionaries and `Stop N` shortcuts are forbidden as
classification rules.

#### 1. Source atom

A source atom is a deterministic text unit with a stable identity and a
source position:

- `atomId`: the ordinal in source order, zero-padded (`a-001`). It is
  stable for identical input.
- `sourceStart`, `sourceEnd`: offsets into the editorial unit.
- `text`: the exact source slice.
- Provenance: `blockKind` (`HEADING | LIST_ITEM | TABLE_CELL | LINE`) and
  `fragment` (only for a bounded split of an over-long piece).

Boundaries come only from neutral text structure: line breaks, unescaped
table pipes, and sentence-final punctuation followed by whitespace. A
terminator right after a token of at most three letters or digits is not a
boundary. This abbreviation guard works by token length, never by a word
list. Merging is always safe: it makes atoms coarser and never drops text.
A piece longer than the atom bound is split at whitespace into fragments
that keep their offsets.

Atoms and separators partition the unit exactly. A separator is whitespace,
a newline, a table pipe, or a piece with no letter or number once URL
targets are elided (pure markup, or an image whose only content is its
URL). Such a piece cannot name a place, so dropping it from labelling loses
nothing semantic. Its range is still recorded. No text disappears because
of a token budget: a unit too large for one request is batched (below).

The model sees each atom with markdown link and image targets and bare URLs
replaced by `…`. Every presented character maps back to a source offset.

**Editorial structure (source-noise boundary, A.1).** A heading-bounded
unit can run past the article into page chrome: site menus, share bars,
tag lists, related posts. Web source content arrives as markdown (Tavily
extract, Cloudflare browser-rendering), so no DOM role or article subtree
survives. The deterministic, semantic-neutral evidence that does survive
is link structure:

- an atom is *link-only* when every letter or number lies inside a
  markdown link or image construct (after a list or heading marker);
- a run of at least 3 consecutive link-only atoms is a
  `NAVIGATION_BLOCK`, and its atoms are marked non-editorial before
  labelling.

They stay atoms, with the same IDs, offsets and text. Each one gets a
structural `NON_EDITORIAL` label that goes through the same exactly-once
check, and the trace records the block. They are never presented to the
model and never carry membership. A lone link-only atom and a prose line
that contains a link stay editorial. Tourism or keyword lists (hotels,
booking, related, subscribe) are forbidden as noise rules.

#### 2. Semantic classification

Every atom receives exactly one classification:

| Classification | Meaning | Membership effect |
|---|---|---|
| `ITINERARY_STOP` | a place the source directs the traveller to visit, stop at, enter, experience, or otherwise treat as a destination of the itinerary | mandatory |
| `ROUTE_LEG` | a real geographic entity the traveller is told to follow, walk or ride along, cross, traverse or use as the path, which is not itself a visit | route provenance, never membership |
| `OPTIONAL_STOP` | a named place presented as optional or extra | optional, never mandatory |
| `ALTERNATIVE` | a choice among places, or a recommendation among options (for example where to eat) | a choice group, never flattened |
| `TRANSFER` | describes or announces a motorized or public-transport move to the next part of the itinerary | segment boundary |
| `PASS_BY` | a place merely seen, passed, referenced or used as context, with no instruction to visit it or use it as the path | context, never membership |
| `NON_ITINERARY` | description, history, tips, captions, ads, navigation, author notes | none |

Boundaries between the classes:

- **`ROUTE_LEG` vs `ITINERARY_STOP`.** A street, promenade or corridor
  that is itself the destination or the experience ("walk the length of
  the pedestrian street X, the city's most famous") is an
  `ITINERARY_STOP`. A street or avenue walked to get between stops is a
  `ROUTE_LEG`. `ROUTE_LEG` must never empty an Experience whose identity is
  travelling that corridor. RW3 Caminito is the regression case.
- **`ROUTE_LEG` vs `PASS_BY`.** `ROUTE_LEG` is the path the traveller is
  told to use. `PASS_BY` is something only seen or mentioned on the way.
- **Areas and generic descriptions.** A neighbourhood or district that is
  only entered, crossed, used as a transfer direction or named as context
  ("now you are entering X", "bus to X") is `ROUTE_LEG` or `PASS_BY`, not
  membership. An area is an `ITINERARY_STOP` only when the source treats
  the area itself as a destination to explore. A generic description
  without its own geographic identity ("a big building with columns", "the
  oldest neighbourhood") is not an entity. A description that identifies
  one specific place ("the national history museum") is an entity.

These are semantic distinctions for the LLM. Production code must not
implement them with phrase lists.

Walking between places is never a `TRANSFER`. `transferMode`
(`BUS | TAXI | METRO | TRAIN | TRAM | FERRY | CAR | OTHER_MOTORIZED |
UNSPECIFIED`) is optional semantic metadata on a `TRANSFER` atom.

#### 3. Zero-to-many entities per atom

An atom is not a stop. One atom may name zero, one or several places, each
with its own role:

```json
{
  "atomId": "a-012",
  "classification": "ITINERARY_STOP",
  "entities": [
    { "sourceName": "the old lighthouse", "supportSpan": "climb the old lighthouse", "role": "ITINERARY_STOP" },
    { "sourceName": "Harbour Road", "supportSpan": "walking along Harbour Road", "role": "PASS_BY" }
  ],
  "reason": "audit only"
}
```

- `sourceName` is the exact source wording. No translation, expansion or
  canonical naming happens here. Identity stays with the geographic
  resolver. `MISSING_NORMALIZATION_KIND` and the identity gates are
  unchanged; this contract simply never asks for normalization.
- `supportSpan` must be inside that atom. Containment ignores only case,
  accents, emphasis/escape/quote characters and whitespace runs. The span
  is mapped back to source offsets.
- `sourceName` must be inside its `supportSpan`. A name that is not in the
  atom is an invented entity and makes the response invalid.
- Anaphora (`mentionAtomId`, contract A.2): an atom may direct a visit to
  a place named in an earlier atom ("Jump inside.", "enjoy the park"). The
  LLM identifies the antecedent atom; code verifies the explicit
  reference and never resolves pronouns or nouns itself.
  - The cited atom must exist, precede this atom, be editorial, and have
    been presented in the same request. Otherwise: `BAD_MENTION_ATOM`.
  - The surface form must be written in this atom's `supportSpan` ("the
    park") or in the cited atom (zero anaphora). Otherwise:
    `NAME_NOT_IN_MENTION_ATOM`.
  - After batches merge, the reference resolves to an entity the cited
    atom itself carries. In order: the exact canonical name; else the only
    entity whose name contains the surface form as whole words; else the
    cited atom's only entity.
  - Otherwise the unit fails closed with `MENTION_ANTECEDENT_AMBIGUOUS`
    (several candidates) or `MENTION_ANTECEDENT_MISSING` (none, or the
    antecedent is unresolved).
  - The resolved entity takes the antecedent's `sourceName`. It keeps its
    own `supportSpan` and offsets plus the antecedent's atom and span, so
    provenance holds both.
  - Assembly refuses an unresolved anaphor and merges a resolved one with
    the earlier mention, so source order is kept.
- Role authority (accepted v5 representation, R2): an atom's structural
  kind is `CONTENT`, `TRANSFER` or `NON_ITINERARY`, and entity roles are
  the only role authority. The model's fine classification is kept for
  audit. Consistency fails closed only where membership can be hidden or
  invented:
  - an atom the model calls `ITINERARY_STOP` without an
    `ITINERARY_STOP` entity (`STOP_WITHOUT_ENTITY`, the missing-stop
    signal);
  - a `NON_ITINERARY` atom with entities.

  A content atom whose place is unnamed ("two ice-cream shops") adds no
  membership. It is recorded as an audit note, not a failure.
- Transfer destinations (R1): every entity on a `TRANSFER` atom becomes
  `TRANSFER_DESTINATION` provenance of the segment the transfer opens,
  whatever role the model wrote (kept as `modelRole`). It is never
  membership, structurally. Membership of the next segment comes only
  from non-transfer atoms; a later atom may still make the same place a
  stop.
- `reason` is audit only and never authority. No canonical entity IDs, and
  no model-authored ordinals.

#### 4. Exhaustiveness invariant

Every input atom appears exactly once in the semantic result. The result is
invalid, and extraction FAILS CLOSED for that unit, when any atom is
missing or duplicated, any label names an unknown atom (including a
read-only context atom), any label or entity is malformed, a span is
outside its atom, a name is outside its span, or roles are inconsistent.
There is no partial acceptance and no fallback to the generative candidate
contract.

A rejected result gets at most one relabel round. The model relabels only
the rejected atoms, sees the validator's issue codes and preceding atoms as
context, and its answer passes through the same validation; the whole unit
is then re-checked. This is not a repair by guessing. An unknown atom ID or
a malformed response is not repairable, and a second invalid answer fails
closed.

When the atoms do not fit one request, they are batched under their global
IDs, at about 2500 presented characters per batch. Batching is also the
default, because a single response labelling ~180 atoms exceeded the
extractor transport's fixed 25 s timeout. Only editorial atoms are
batched. Non-editorial atoms are accounted for by their structural labels
in the same exactly-once merge. Each atom belongs to exactly one batch. Preceding atoms may be shown
as read-only context. A batched result is valid only if each batch is valid
for its own scope and the union labels every unit atom exactly once.

#### 5. Deterministic assembly

The backend derives every fact that needs no further interpretation:

- **Order:** atom order, then span position inside the atom. Never a
  model-generated ordinal.
- **Segments:** a `TRANSFER` atom closes the current segment once that
  segment has membership from a non-`TRANSFER` atom. Adjacent `TRANSFER`
  atoms, such as a heading and the sentence that follows it, form one
  boundary. A transfer's destination is provenance of the segment it
  opens, never membership. The model is never asked to remember to emit a
  separate candidate per segment.
- **Membership:** only `ITINERARY_STOP` entities are mandatory.
  `OPTIONAL_STOP` stays optional. `ALTERNATIVE` entities form choice
  groups: consecutive alternative-bearing atoms (atoms with no entities do
  not interrupt). `A or B` never becomes `A + B`. `ROUTE_LEG` entities are
  kept per segment, in source order, as route provenance. They are never
  component membership, so they never trigger the all-components identity
  rule. `PASS_BY` keeps provenance only. `NON_ITINERARY` contributes
  nothing.
- An exact repeat of a folded name inside one segment is one member with
  all of its provenance. A mandatory occurrence absorbs weaker ones. This
  is string equality, not identity.

Each segment with mandatory membership is a source-defined composition
candidate. Optional, alternative and route-leg members are not flattened
into it. Until the candidate model can represent them, they live only in
extraction provenance (the trace), never as components. Its members carry `sourceName`, `supportSpan` and source offsets
into the existing source-support → identity → geography →
`INCOMPLETE_SOURCE_COMPOSITION` path, which is unchanged.

#### 6. Failure policy

Incomplete or structurally inconsistent labelling FAILS CLOSED for that
unit and records the issue list (atom IDs and codes). Never fall back to
accepting a generative candidate, never repair labels by guessing, and
never relax a downstream gate to compensate.

Outcomes are reported separately and are never conflated.

Extraction outcome per unit, known at runtime:

- `ASSEMBLED`: the labelling is valid and the segments are built.
- `CONTRACT_FAIL_CLOSED`: the labelling still breaks the technical
  contract after the relabel round (span, name, reference, anaphora or
  consistency issues with atom IDs). This is not a semantic-fidelity
  finding.
- `INVALID_RUN`: a provider or transport failure in any batch or in the
  relabel call (for example the 25 s timeout). It is operational, never
  semantic.

Semantic outcome of an `ASSEMBLED` unit, known only by evaluation against
an oracle or by review, never computed at runtime:

- fidelity pass: the structural fidelity properties below hold, and every
  source-required stop is mandatory;
- `SEMANTIC_FIDELITY_ERROR`: an explicit atom label disagrees with the
  source (for example `Obelisco → PASS_BY` at a named atom). It is a real
  disagreement and is never relabelled "correct". It is also not an
  omission: the decision is on a named atom, in the trace.

Downstream outcome of a fidelity pass:

- `FIDELITY_PASS_IDENTITY_PASS`: every mandatory member verified, and the
  composition proceeds through the unchanged gates;
- `FIDELITY_PASS_IDENTITY_BLOCKED`: extraction produced the expected
  mandatory structure, but identity, geography or
  `INCOMPLETE_SOURCE_COMPOSITION` rejected a named entity. This is a
  downstream blocker. A mandatory stop is never deleted or downgraded to
  make identity pass, and thresholds and source-support rules stay
  unchanged.

### Fidelity acceptance model (owner, 2026-10-06)

RW4 extraction fidelity no longer requires near-perfect oracle
classification of every ambiguous atom. Semantic labels are probabilistic
on borderline atoms ("you will see X", walked streets, areas). The goal is
**observable fidelity plus fail-safe processing**. A source unit meets
the extraction-fidelity requirement when:

1. every source atom is accounted for exactly once (labelled, or
   structurally `NON_EDITORIAL`);
2. no source atom silently disappears;
3. every mandatory itinerary fact the semantic pass represents leaves an
   auditable atom and entity decision;
4. source order is deterministic;
5. source-defined segment boundaries are deterministic;
6. transfer destinations do not become membership, structurally;
7. alternatives are not flattened into mandatory membership;
8. non-membership roles never silently become mandatory components;
9. ambiguous semantic decisions remain visible in the trace;
10. semantic fidelity errors, contract fail-closed, provider failures and
    downstream identity failures are reported as distinct outcomes.

An explicit wrong label remains a semantic disagreement with the oracle
and is reported as one. What this model rejects is treating such a
disagreement as equivalent to a silent omission.

### Production observability (required before any cutover acceptance)

For every atomized unit, the generation trace must record at least the
following (the spike's `unitTrace` is the reference shape):

- source unit ID and source URL;
- source completeness state (`sectionComplete`);
- atomizer, editorial-structure and prompt versions;
- atom count, and the atom IDs with their source offsets and editorial
  flag;
- non-editorial blocks (first and last atom, reason);
- the semantic label of every atom;
- each entity's role, `sourceName`, `supportSpan` and source span;
- `mentionAtomId` and the resolved antecedent, when used;
- transfer boundaries (opening transfer atoms, mode) and transfer
  destinations as provenance;
- the assembled segment count;
- mandatory membership before identity, as `sourceName`, `supportSpan`
  and provenance atom IDs, in source order;
- route-leg, optional, alternative-group and pass-by members per segment;
- batch and relabel activity, with issue codes and atom IDs;
- the contract outcome (`ASSEMBLED | CONTRACT_FAIL_CLOSED |
  INVALID_RUN`);
- the provider or batch failure, if any (`kind`, `batchIndex`, message).

The semantic outcome is attached by evaluation or review. The trace must
be enough to prove the statement "extraction faithfully produced the
expected mandatory structure, but identity rejected entity X", even when
no Experience row is persisted. Without it, extraction fidelity cannot be
judged when identity later rejects a candidate, and
RW4-EXTRACT-COMPLETENESS-1 cannot be closed.

### Productization milestones

- **A. Taxonomy gate (spike). CLOSED: COMPLETED_WITH_FINDINGS
  (2026-10-06).** `ROUTE_LEG` (v3), prompt v4, and the representation
  revision v5 (`TRANSFER_DESTINATION` provenance, entity roles as the
  only role authority) all failed the frozen semantic-accuracy gate, and
  that gate is not marked PASS. No further prompt or taxonomy tuning is
  authorized. The architectural value (observability, deterministic
  structure) is accepted under the fidelity acceptance model above.
  Boundary hardening landed in the spike:
  - A.1 editorial structure (navigation blocks);
  - A.2 verified anaphora;
  - A.3 bounded, typed batching with `INVALID_RUN` for transport
    failures.

  All ten structural readiness properties hold (spike README). The
  recommendation is READY_FOR_B.
- **B. Production port. IMPLEMENTED (2026-10-06).**
  - Code: `be/src/modules/tours`, starting at
    `services/atomized-source-unit-extractor.ts`. The routing predicate is
    `isAtomizableSourceUnit`.
  - Integration decisions made during B:
    - Identity routes on `GeoEntityHint.expectedKind`, which this contract
      does not carry. A bounded member-kind call runs per candidate
      segment after assembly. It is exactly-once by member ID, and a
      missing, duplicate, unknown or invalid kind fails the unit closed.
      It never adds, drops or reorders a member, and the labelling prompt
      stays byte-identical to v4.
    - Candidate names come only from the source: the unit heading; with
      several segments, heading + the segment's unique source heading;
      else the grounded title; ` (part N of M)` only to disambiguate.
    - Members enter the unchanged `extractExperienceCandidates` gate as
      their source wording, with no normalization claimed. Their support
      span is a literal unit slice.
    - Themes, intents and traits stay empty; evidence-only classification
      owns them.
  - Open scope finding: a whole unit that arrives as a continuation window
    still takes the generative path (RW4-ATOM-SCOPE-1).

  Original scope:
  - port atomization, editorial structure, validation, anaphora
    resolution and assembly into `be/src` as a provider-neutral utility;
  - a typed semantic result contract and typed roles;
  - deterministic assembly and the complete per-unit trace above;
  - only for `SECTION_UNIT` windows with `sectionComplete=true`;
  - the free-form generative composition path disabled for the same
    complete unit (one composition authority per unit);
  - all downstream source support, identity, geography, dedupe and
    persistence behaviour preserved.

  Verify first that a hint whose name equals the source wording does not
  require `normalizationKind`. Measure the real batching cost and the
  timeout rate: in the spike, SOB batches ran close to the 25 s transport
  timeout, so decide on an explicit atom-labelling timeout or a smaller
  bound from measurements.
- **C. C3.** COLD first. WARM only if COLD persists a qualifying
  composite.

A provider or transport failure is an operational failure, not a semantic
one.

### What this changes and what it does not

- An omission becomes observable. "Atom `a-079` is labelled `PASS_BY`"
  is an explicit, reviewable decision. A silently dropped stop is not.
- Segment loss and segment mixing caused by the model forgetting to emit
  a candidate become structurally impossible. Mixing remains possible only
  as a visible labelling decision (for example a transfer heading labelled
  as a stop).
- Semantic labels are still probabilistic. Exhaustiveness does not prove
  that `ITINERARY_STOP` vs `PASS_BY` is right. It makes every such call
  explicit and auditable.

Productization requires the spike's evidence and a separate owner
authorization. The production extractor path stays unchanged until then.
Spike evidence (2026-10-06, Gemini `gemini-3.5-flash-lite`, frozen
`SECTION_UNIT`s and oracle) is in
`spikes/rw4-atom-labelling-2026-10-06/README.md`.

## Experience Domain V2 — partial source compositions and administrative identity correction (2026-10-08)

**Status: IMPLEMENTED (owner decisions D1–D7, 2026-10-08).** Investigation:
`spikes/partial-composite-investigation-2026-10-07/`. Implementation
evidence: `spikes/partial-composite-implementation-2026-10-08/`.

This amends the all-or-nothing composition rule above
(`INCOMPLETE_SOURCE_COMPOSITION` for any unresolved member).

### Source members

An `ExperienceComponent` is one **source-declared member** of the
Experience composition, not a unique GeoEntity membership row. Every member
persists, resolved or not, in source order (`sourcePosition`, never
renumbered). An unresolved member keeps its source wording and typed
`resolutionReason`; no GeoEntity is invented for it and no ambiguous
candidate is attached to it. Two members may resolve to the same GeoEntity
("Caminito" and "Caminito Street") and stay two members. One membership
authority (`experience-source-membership.policy.ts`) answers every read:
all / resolved / unresolved members, distinct resolved GeoEntities, and the
navigable view (one resolved member per distinct GeoEntity).

### Admission

```text
COMPLETE = every source member resolved                  -> admitted
PARTIAL  = >= 2 DISTINCT resolved GeoEntities
           AND every unresolved member is MISSING_KNOWLEDGE -> admitted
anything else incomplete -> INCOMPLETE_SOURCE_COMPOSITION
```

No percentage threshold. The unchanged composite geographic validator then
judges the resolved members. Completeness is derived from the rows, never
stored. One classification authority
(`component-deficit-classification.policy.ts`) maps each deficit:

| Class | Deficit reasons | PARTIAL |
| --- | --- | --- |
| MISSING_KNOWLEDGE | NO_CANDIDATE_ACQUIRED, CANDIDATE_UNCONFIRMED, AMBIGUOUS_CANDIDATES, CANDIDATE_REJECTED (candidate-level), RESOLUTION_REVOKED (admin) | eligible |
| CONTRADICTORY_EVIDENCE | IDENTITY_CONFLICT, DESTINATION_INCOMPATIBLE | blocks |
| UNKNOWN | DESTINATION_COMPATIBILITY_UNKNOWN | blocks |
| SYSTEM_FAILURE | PROVIDER_FAILURE, IDENTITY_AUTHORITY_UNAVAILABLE (Wikidata unavailable) | blocks |
| INVALID_SOURCE_COMPONENT | not produced yet | blocks |

A transient failure never becomes durable domain incompleteness.

### Readers

Unresolved members never become navigable POIs, coordinates, duration
inputs, embedding text or Tour snapshot rows. Catalog composite retrieval
counts distinct resolved GeoEntities, never rows. Dedupe identifies a
resolved member by its GeoEntity and an unresolved one by its source
wording, so a PARTIAL A-B-C-D-E-F with only A and B resolved is not the
COMPLETE A-B, and an unresolved member never becomes a shared `null`.

### Tours and enrichment

An Experience is mutable and shared by future materializations. A Tour
already freezes its components in `TourExperienceComponent`, so enrichment
reaches only Tours materialized after it. `ExperienceVersion` is deferred.

### Administrative identity correction

`GeoEntity.verifiedHintNameKeys` stays the fast lookup index.
`GeoEntityVerifiedHintAssertion` records who asserted each hint (AUTOMATIC
or ADMIN, optional actor `User`) and keeps revoked assertions as history.
Admin verification is catalog knowledge, never provider metadata: provider
names and OSM/Wikidata aliases are untouched.

- REVOKE_VERIFIED_HINT: stamps the assertion; when no active assertion still
  supports the pair, the key leaves the index and the members linked through
  it become UNRESOLVED (`RESOLUTION_REVOKED`). Each affected Experience is
  re-admitted (COMPLETE/PARTIAL) or ARCHIVED. The automatic resolver does not
  re-learn a revoked pair.
- CONFIRM_EXISTING_GEOENTITY: links one unresolved member to an existing
  GeoEntity and learns its hint (ADMIN assertion + index), so
  `findGeoEntityCandidatesForHint` returns it as `VERIFIED_HINT`. It fails
  explicitly when the hint is active on another GeoEntity.
- LEAVE_UNRESOLVED: no write. CREATE/IMPORT GEOENTITY: out of scope.

Future backoffice (not built): list PARTIAL Experiences with their
unresolved members (source name, position, provenance, reason), candidate
GeoEntities with coordinates for a map, and the three actions above. Role
authorization is future work.

## Experience Domain V2 — gather, reconcile, then plan (2026-10-08)

**Status: IMPLEMENTED, not merged.** Evidence:
`spikes/gather-reconcile-plan-2026-10-08/README.md`.

### Invariant

For one generation, every Experience observation acquired inside the
authorized acquisition budget is reconciled into the canonical catalog
before the final candidate snapshot is chosen. The Tour is composed from the
best canonical knowledge available at the end of bounded acquisition, never
from an earlier snapshot. Acquisition order does not decide eligibility.

```text
INITIAL_CATALOG_SNAPSHOT
→ GATHER (coverage passes; provisional plan → PLANNER_CAPACITY acquisition)*
   each execution: resolve → validate → dedupe → persist NEW
                   or reconcile SAME knowledge
→ ACQUISITION_COMPLETE_FOR_GENERATION
→ FINAL_CATALOG_SNAPSHOT (read after the last acquisition)
→ FINAL ranking / composition → FINAL plan → TourExperience snapshots
```

Gather stays bounded: it runs exactly the work current policy already
authorizes (coverage passes, the planner-capacity pass budget, source-plan
dedupe, provider limits). It never searches "until complete".

### Snapshots and planning

- A snapshot is a fresh read through the catalog boundary (destination
  window filtered by PD1 eligibility + exact rows of request-scoped ids),
  ordered by id. Nothing from an earlier snapshot (hydrated objects, weights,
  scores, composition inputs) survives into a later one.
- A plan derives every planner input from one selection.
- A plan computed only to discover residual capacity is PROVISIONAL. When a
  planner-capacity acquisition follows it, it is discarded: the catalog is
  re-read, recomposed and re-planned, with reservoir promotion.
- Each snapshot records the acquisition epoch it was read at; planning from
  a snapshot older than the last acquisition fails closed. When no
  acquisition happened after the last read, that read is the final
  snapshot.

### SAME reconciliation (union of knowledge, not of Experiences)

Owner: `source-knowledge-reconciliation.policy.ts`, applied inside the
catalog's SAME transaction.

- Eligible only for a SAME identity decision over `EXACT_COMPOSITION`.
  SUBCOMPOSITION, PARTIAL_OVERLAP and DISJOINT never merge members; a shared
  source URL is not enough.
- Member correspondence is the dedupe authority's `sharedSourceMembers`.
- An unresolved canonical member becomes RESOLVED (AUTOMATIC) when its
  corresponding observed member resolved it. A resolved member is never
  downgraded. Source identity (id, `sourcePosition`, `sourceName`, member
  count) never changes.
- Two GeoEntities for one corresponding member is a conflict: the
  observation writes no member knowledge (no recency/provider/order
  tie-break). The dedupe authority already refuses SAME in that case; the
  policy check is defense in depth.
- A member an administrator revoked (`RESOLUTION_REVOKED`) is not re-learned
  automatically.

### Embeddings

The SAME write nulls the vector and its index identity in the same
transaction, and the resolver reindexes synchronously. A stale vector can
never rank the enriched Experience. If the provider is unavailable, the
Experience falls in the explicit "no compatible embedding" tier.
