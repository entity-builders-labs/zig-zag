# Adquisición de candidatos: guía informal del flujo

> Explicación en lenguaje llano del árbol de decisión detrás de "Verified pool"
> (paso 2 del flujo de 5 etapas en
> [`activity-discovery-and-tour-generation.md`](./activity-discovery-and-tour-generation.md)).
> Sirve como introducción intuitiva antes de leer ese documento, que es la
> fuente de verdad normativa. Ver la sección **Matices vs. la arquitectura
> formal** al final antes de asumir que cada frase acá es una regla exacta.

La idea clave es esta:

```
CATÁLOGO
   ↓
¿alcanza para este intent?
   ├── sí → NO SEARCH
   └── no
        ↓
¿sé qué entidad/concepto estoy buscando?
   ├── sí → Places Text Search / exact resolution
   └── no
        ↓
¿el gap es una categoría local y espacial?
   ├── sí → Places Nearby Search
   └── no → Grounded Search
```

Y después todo lo descubierto termina pasando por resolución/validación.

## Rol de cada herramienta

| Herramienta | Pregunta que responde | Ejemplo |
|---|---|---|
| Catálogo propio | "¿Ya tengo suficientes candidatos buenos?" | Ya tengo Louvre, Orsay, Montmartre… |
| Places Text Search | "Sé más o menos qué estoy buscando, ¿qué lugar real corresponde?" | "Mercado de San Telmo Buenos Aires" |
| Places Nearby Search | "¿Qué lugares de cierto tipo hay dentro de esta zona?" | cafés / museums / restaurants dentro de San Telmo |
| Grounded Search | "¿Qué debería conocer/existir para este tipo de viaje?" | "best historic tango walks in Buenos Aires" |
| Places/OSM resolution | "¿Cuál es exactamente la identidad/geometría de lo que descubrí?" | Plaza Dorrego → Place ID; Defensa → OSM way |

Evitá pensar Grounded Search como otro Places search. Cumplen roles diferentes.

## Flujo ideal completo

Supongamos:

```
Buenos Aires
themes = tango, history, food
formats = neighborhood_walks, experiences
style = local_deep_dive
```

### 1. Primero consultás tu catálogo

```
catalogActivities = findCandidates(destination, themes, formats)
```

Podés encontrar: Teatro Colón, MALBA, Plaza de Mayo, Mercado de San Telmo, Caminito...

Después corre `CoverageAnalyzer`. No debería preguntar solamente "¿tengo 30
activities?", sino "¿tengo cobertura suficiente para tango?, food?,
neighborhood_walk?, local deep dive?"

Supongamos que devuelve:

```
✓ history POIs
✓ food POIs
✓ iconic attractions

✗ tango neighborhood walk
✗ local San Telmo experience
```

Ahí recién decidís buscar.

### 2. ¿Puedo resolver el gap directamente con Places?

Hay gaps donde no necesitás Grounded Search. Ejemplo: "Necesito más mercados
en San Telmo" — ya sabés `concept = market`, `area = San Telmo`. Entonces:

```
Places Nearby Search
type=market
locationRestriction=San Telmo
```

Podrían aparecer: Mercado de San Telmo...

Eso es mucho más barato y determinístico que preguntarle a un LLM "¿Qué
mercados debería visitar?".

### 3. Cuándo usar Places Text Search

Text Search sirve mucho cuando ya tenés una entidad o intención concreta
textual. Por ejemplo, Grounded Discovery te dijo: Plaza Dorrego, Mercado de
San Telmo, Pasaje San Lorenzo. Ahora querés saber "¿Qué entidad real es
'Plaza Dorrego'?". Usás:

```
Places Text Search: "Plaza Dorrego Buenos Aires Argentina"
```

Y después eventualmente `Place Details` para obtener identidad canónica.

También podés usar Text Search directamente sin Grounding — ej. "user wants
tango shows" → `Text Search: "tango show Buenos Aires"` — porque el query ya
es concreto.

### 4. Cuándo usar Nearby

Nearby es más espacial. Tenés `lat/lng + radius/boundary` y preguntás "¿qué
hay acá?". Por ejemplo, ya seleccionaste San Telmo y querés completar
candidatos:

```
San Telmo polygon
      ↓
Nearby Search
      ↓
museums / restaurants / cafes / tourist attractions / markets
```

Nearby es muy bueno para densificar una zona, pero no es bueno para contestar
"¿Cuál es la experiencia cultural importante de San Telmo?", porque te
devuelve establecimientos, no conocimiento turístico.

### 5. Cuándo entra Grounded Search

Grounded Search aparece cuando tenés un knowledge gap, no simplemente falta
de Places. Ejemplo — coverage deficit: `tango + neighborhood_walk`. No sabés
todavía qué barrio, qué recorrido, qué componentes, qué experiencia realmente
tiene sentido. Ahí sí, `GroundedSearchProvider` puede descubrir:

```
San Telmo historic/tango walk

area: San Telmo
entities: Plaza Dorrego, Defensa, Pasaje San Lorenzo, Mercado de San Telmo...
```

Grounded Search respondió *qué debería existir como concepto turístico*. Pero
todavía no confiás en identidad/geometría.

### 6. Grounded Search nunca persiste directamente

El resultado (`ActivityProposal`) puede ser "San Telmo Tango Walk" con:

```
EntityHints
├─ San Telmo
├─ Plaza Dorrego
├─ Defensa
├─ Pasaje San Lorenzo
└─ Mercado de San Telmo
```

Después, `ActivityProposalResolutionService` resuelve cada uno:

```
San Telmo            → OSM / Nominatim  → polygon
Plaza Dorrego         → Google Places Text Search → Place ID
Mercado de San Telmo  → Google Places   → Place ID
Defensa               → OSM             → street geometry
Pasaje San Lorenzo    → OSM / possibly Places
```

Entonces: `Grounded Search → concept`, `Places / OSM → identity`. Esa
separación es muy importante.

### 7. ¿Y Places Nearby después de Grounded?

También. Supongamos que Grounded Search propone "San Telmo Food Walk" con
evidencia: San Telmo, Mercado, Defensa, Plaza Dorrego. Pero querés enriquecer
el composite. Después de resolver San Telmo:

```
San Telmo polygon → Nearby Search → food POIs → candidate enrichment
```

Podrías encontrar lugares adicionales. Conviene separar *grounded evidence
entities* de *Nearby enrichment candidates*, porque tienen distinta
procedencia/confianza.

## El árbol de decisión que implementaría

```
buildCandidatePool(intent, destination)

1. Catalog
   ↓ retrieve existing matching Activities

2. CoverageAnalyzer
   ↓ enough coverage?
       YES → STOP acquisition
       NO  → produce CoverageDeficits[]

3. For each deficit:

   A. KNOWN ENTITY / KNOWN QUERY
      "Mercado de San Telmo" / "tango show"
            ↓
      Places Text Search

   B. LOCAL CATEGORY GAP
      "need restaurants in San Telmo" / "need museums around Montmartre"
            ↓
      Places Nearby

   C. KNOWLEDGE / EXPERIENCE GAP
      "need meaningful tango neighborhood walk"
      "need local deep-dive architecture experience"
            ↓
      Grounded Search → ActivityProposal → Places/OSM resolution

4. Normalize all resolved candidates
5. Admission / quality filters
6. Add approved reusable Activities to pool/catalog
7. CoverageAnalyzer again
8. stop when sufficient
```

Ese `CoverageAnalyzer` otra vez después de adquirir es importante. No
haría `catalog insufficient → Places → Grounded → Nearby → todo siempre`,
porque gastarías APIs al pedo. Haría `acquire minimally → reevaluate →
acquire more only if needed`.

### Ejemplo Paris

Usuario: Paris, `food + architecture + culture`, `local_deep_dive`.

Catálogo: Eiffel Tower, Louvre, Notre-Dame, Arc de Triomphe, Musée d'Orsay...

Coverage:

```
✓ iconic architecture
✓ culture
✗ local food
✗ neighborhood exploration
```

No necesitás Grounding para conseguir "restaurants near Le Marais" → Nearby
Search. Pero te falta "meaningful local neighborhood experience" → Grounded
Search puede descubrir Rue Mouffetard food exploration, Saint-Germain
café/cultural walk, Montmartre art walk. Después Text Search/OSM resuelve
Rue Mouffetard, Marché..., Place..., streets...

## Una distinción que mantendría estricta

```
Places Text Search  = RESOLVE / FIND something I can describe
Places Nearby Search = ENUMERATE things of a known category in a known area
Grounded Search       = DISCOVER what is meaningful/relevant when I don't
                         already know the answer
Catalog                = DON'T SEARCH if I already know enough
```

Eso evita usar un LLM para cosas que Google Places resuelve mejor, y también
evita pretender que Places te diga qué constituye una experiencia turística
coherente.

## El orden ideal de la arquitectura

```
                  ┌───────────────┐
                  │  Tour Intent  │
                  └───────┬───────┘
                          ▼
                  ┌───────────────┐
                  │    Catalog    │
                  └───────┬───────┘
                          ▼
                  ┌───────────────┐
                  │   Coverage    │
                  │   Analyzer    │
                  └───────┬───────┘
                          │
                      sufficient?
                    YES /       \ NO
                       /         \
                    STOP          ▼
                              classify gap
                                  │
                  ┌───────────────┼────────────────┐
                  ▼               ▼                ▼
             known query      spatial/category   knowledge gap
                  │               │                │
             Text Search       Nearby           Grounded
                  │               │                │
                  │               │          ActivityProposal
                  │               │                │
                  └───────────────┴───────┬────────┘
                                          ▼
                                   Places / OSM
                                1. Entity Resolution
                                          ▼
                                 2. Geographic Validation
                                    (coherence/bounds)
                                          ▼
                                 3. Catalog Materialization
                                    (persist & requery)
                                          ▼
                                   Candidate Pool
                                          ▼
                                   Coverage again
```

Grounded Search es deliberadamente el recurso de mayor nivel semántico y
debería ser condicional, no una llamada obligatoria para cada tour.

## Matices vs. la arquitectura formal

Este documento es una guía intuitiva, no la especificación. Comparado con
`activity-discovery-and-tour-generation.md` y el plan de PRs, hay precisiones clave a tener en cuenta:

1. **Grounded no es un solo modo.** El código actual (`ActivityDiscoveryService`)
   distingue `discoverBootstrap()` (destino nuevo/sin perfil) de
   `discoverGaps()` (destino conocido con un deficit puntual) — dos decisiones
   tipadas separadas en `CoverageAnalyzer`, no una sola caja "Grounded
   Search".
2. **Pipeline tripartito de propuestas.** Una propuesta descubierta (`ActivityProposal`) pasa por 3 etapas estrictamente aisladas:
   - **Resolución de Entidades (`Entity Resolution`)**: asocia hints a lugares concretos (Places/OSM). No valida coherencia ni persiste.
   - **Validación Geográfica Determinística (`Geographic Validation`)**: comprueba si el conjunto de componentes satisface las reglas del kind (`NEIGHBORHOOD_WALK`, `ROUTE`, `EXPERIENCE`) y queda acotado dentro del destino.
   - **Materialización de Catálogo (`Catalog Materialization`)**: persiste en una única transacción atómica las propuestas aceptadas como `Activity`, familias y waypoints, re-consultando el catálogo para alimentar el pool unificado.
3. **Inicio asíncrono con Outbox Transaccional.** El wizard (`TourGenerationService.createTourFromWizard`) no dispara promesas sueltas (fire-and-forget). Crea el `Tour` en estado `pending` y encola `TourGenerationRequested` en la tabla `OutboxEvent` en la misma transacción atómica de base de datos.
4. **Enriquecimiento de fotos fuera del camino crítico.** La búsqueda y asociación de imágenes de Wikimedia/Commons corre asincrónicamente vía `ActivityMediaEnrichmentRequested` y emite `ActivityMediaUpdated`. El enriquecimiento multimedia nunca bloquea la finalización del tour ni la planificación del itinerario.
5. **Falta la salida de "explicit failure".** Si después de agotar catálogo +
   Text Search + Nearby + Grounded el pool sigue sin ser usable, el flujo
   debe fallar explícito **antes** de llegar al LLM de itinerario — nunca
   seguir con un pool insuficiente.

Además, la separación búsqueda/extracción ya está implementada:
`GroundedSearchProvider` (evidencia real — SerpApi / Tavily) y `SearchGroundedDiscoveryProvider` (extracción estructurada — Groq / Gemini)
son interfaces separadas; la extracción nunca inventa evidencia propia, ni a
nivel proposal ni a nivel de cada `entityHint`.
