# Post-Component-Resolution Independent Architecture Review

Status: **external independent architecture review — reference only**  
Reviewer: **Cline / DeepSeek 4 Pro**  
Reviewed HEAD: `de99eaf1b34616165c59ef4d58f6e1c803667f2f`  
Date: **2026-09-25**

## Authority note

This is the owner-supplied second-pass independent architecture review,
preserved substantially verbatim as historical/reference evidence.

It does **not** override:

- current HEAD code;
- canonical specs;
- canonical Progress;
- later roadmap decisions.

Reviewer recommendations and evaluative language below remain the reviewer's
independent conclusions. Adoption, rejection, sequencing, and current
implementation authority live in the canonical code/specs/Progress/roadmap.

---

## Raw second-pass review — owner-supplied, substantially verbatim

Verificado todo. Estado final confirmado: HEAD = fork = `de99eaf`, árbol limpio, milestone COMPLETE. `setOverlap` = `intersection / Math.max(left.size, right.size)` (línea 410), `componentOverlap >= 0.5` → AMBIGUOUS (línea 190), `trace-failure-semantics.spec.ts` ya trackeado, y el test baseline (`destinationBoundary`, resolver:613) sigue fallando. Aquí está la re-review definitiva.

---

# Second-pass Architecture Review — reconciliada con HEAD final (Stage 5 DONE, milestone COMPLETE)

> Nota de estado: el "estado esperado" del pedido (Stage 5 UNBLOCKED) quedó obsoleto. HEAD real = `de99eaf` ("close component-resolution milestone"), **Stage 5 DONE, milestone COMPLETE**. Uso este HEAD, que el propio usuario confirmó ("ya está stage 5").

## UPDATED EXECUTIVE ASSESSMENT

Mi tesis original ("demasiada inversión en identity/geography, discovery variance + cold latency + tour quality sub-atendidos") ha quedado **refutada en su primera mitad y confirmada en la segunda**, y ahora converge en un hallazgo que no vi venir en el primer reporte.

**Lo que el milestone demostró que estaba mal en mi crítica**: el trabajo de identidad/geografía no era sobre-inversión. Era la base que faltaba, y ahora está **probada end-to-end**: WARM 4/4 `CATALOG_REUSE` con 0 llamadas de identidad externas, composites reales persistidos y seleccionados (COLD 1), fail-closed correcto, trace con fidelidad de fallo completa. Mi frame de "infraestructura vs producto" era demasiado binario: aquí la infraestructura *era* la condición de posibilidad del producto.

**Lo que la evidencia confirmó**: la **varianza del extractor** es, efectivamente, el techo — ahora cuantificada: **2 de 9 passes de extracción web produjeron un composite**. Y **"verified ≠ good tour"** sigue sin ningún loop de evaluación.

**El hallazgo que no anticipé (y que ahora es el OPEN FINDING oficial)**: el dedupe de Experiences **descarta composites válidos de 2 stops** por un artefacto de cardinalidad en `setOverlap`. Un venue único {Plaza Dorrego} y un composite {Plaza Dorrego, Mercado} comparten un GeoEntity → `componentOverlap = 1/2 = 0.5` → `AMBIGUOUS` → fail-closed. El resultado depende del **orden de persistencia**, no de la identidad. COLD 1 perdió un standalone legítimo; COLD 4 perdió un composite completo aceptado por CGV. Esto **contradice directamente** el §16 del amendment ("GeoEntity existence ≠ Experience existence; component membership ≠ standalone Experience authority").

Mi conclusión independiente final: **la dirección es correcta y el milestone está bien cerrado, pero el próximo problema de producto ya está identificado y es agudo**: hay un guard de dedupe que, por construcción, está comiéndose exactamente las experiencias que el sistema acaba de aprender a producir. Eso —no más identidad, no más geografía— es el cuello de botella real ahora.

---

## WHAT I GOT RIGHT THE FIRST TIME

1. **`IdentityVerifier` como autoridad única y pura** — confirmado, sin cambios.
2. **Provider isolation real** — confirmado (Stage 5: "no provider branching added").
3. **Fail-closed sin magic defaults** — confirmado y ahora con la deuda de que *eso mismo* (fail-closed del dedupe) tiene un costo de producto.
4. **La varianza del extractor es el techo de producto** — ahora con número: 2/9 passes.
5. **"NO_OSM_MATCH" colapsaba estados de fallo** — **correcto, y ya FIXED**. En mi primer reporte señalé que `trace-failure-semantics.spec.ts` (entonces untracked) apuntaba a este problema. Stage 5 lo resolvió: `PROVIDER_FAILURE`, `CANDIDATE_REJECTED` vs `CANDIDATE_UNCONFIRMED`, `extractor_envelope_unrecognized`. El test hoy es 15/15 (RED-first, mutation-checked).
6. **No hay loop de calidad de tour** — sigue cierto.
7. **`spatial-footprint` no maneja `MultiLineString`** (planner) — confirmado, y ahora oficialmente "debt carried".
8. **`required` es vestigial** — confirmado (columnas siguen, sin autoridad).

---

## CORRECTIONS TO MY PREVIOUS REVIEW

| Claim anterior | Conclusión actual | Por qué |
| --- | --- | --- |
| "`representativePoint` = primer vértice del polígono" | **Incorrecto.** Es centroide aritmético (promedio de coords); para MultiPolygon usa el primer polígono. La deuda residual es "primer polígono", no "primer vértice". | `experience-proposal-resolver.service.ts:2780-2816`. Me basé en nota de deuda vieja. |
| "San Martín moldea la política de identidad (case-by-case hardening)" | **Sobredimensionado.** No hay `if (name === 'San Martín')`. Solo comentarios/ejemplo y 1 sonda en una caracterización 60/60. Es "harness-only adversarial control", como dice Progress. | Grep de código productivo. |
| "El sistema produce venues, no composites" | **Histórico, superado.** Stage 5 COLD 1 persistió y seleccionó "San Telmo Walking Tour" (2/2, `component_defined`, selected). | `spikes/stage5-.../assessment.md`. |
| "Cold latency (~400s) invalida el producto" | **Extrapolación no sustentada.** Es real en dev/free-tier pero no es predicción de producción. Lo estructural es el fanout + 124 routing calls, no el número absoluto. | Prompt §C + Stage 5 provider counts. |
| "Todo el corpus es San Telmo" | **Impreciso.** Existe Mendoza (SIMPLE/COMPOSITE/MIXED), pero COMPOSITE/MIXED fallaron (F1/F2), así que la evidencia *exitosa* de composites sigue siendo San Telmo-céntrica. | `spikes/stage3-simple-composite-mixed/`. |
| "5 grounded-search providers = demasiados" | **Matizado.** En fase de caracterización es correcto; no implica production-support eterno. | Prompt §16. |
| "Mover generación a background" | **Ya era asíncrono** (outbox + processor). Mi preocupación debió ser time-to-first-useful-result / prewarming. | `TourGenerationProcessorService`. |
| "Cold latency es el risk #1" | **Reordenado.** El risk #1 ahora es el dedupe-policy defect (pérdida de producto determinística), no la latencia ambiental. | Stage 5 OPEN FINDING. |

---

## CURRENT STATE ACCORDING TO HEAD + PROGRESS

- **HEAD**: `de99eaf` (local = fork, árbol limpio, sin ahead/behind).
- **Milestone COMPLETE**: Stage 1–5 DONE. Commits finales de Stage 5: `576bbe5`, `3097641`, `d38d4be`, `f2e164c`, + `de99eaf` (cierre).
- **Validación**: unit 2041/2042 (1 baseline: `preference-first-architecture` regex test); integration 95/98 (3 baseline: 2×`acquisition-degradation`, 1×`canonical-orchestration`); `trace-failure-semantics` 15/15; tsc + eslint limpios; live RW1 = 3 COLD + 1 WARM + 1 COLD dirigido.
- **Composites live**: 2 extraídos (COLD 1 y COLD 4), ambos 2/2 RESOLVED, INSIDE, CGV `component_defined` ACCEPTED. COLD 1 persistió + seleccionado; COLD 4 `AMBIGUOUS_DEDUPE`.
- **WARM**: 4/4 `CATALOG_REUSE`, 0 llamadas de identidad, 338s→65s, counts sin cambios, 0 duplicados.
- **No observado live** (prueba queda determinística): partial composite, AMBIGUOUS/CONFLICTED/provider-failed component, OUTSIDE/INTERSECTS/UNDETERMINED, Plaza de Mayo relation, Calle Defensa ROUTE, POINT_RADIUS, MultiLineString en planner.
- **Threshold decisions**: NEAR, ratio de partial-resolution, minimum component count → todas **NOT SELECTED** (insuficiente evidencia). Disciplina correcta.

---

## CURRENT PRODUCT RISKS

1. **(Alto, determinístico) Dedupe descarta composites de 2 stops y standalones legítimos.** `setOverlap` divide por el conjunto mayor → `{A}` vs `{A,B}` = 0.5 → `componentOverlap >= 0.5` → AMBIGUOUS → fail-closed. Order-dependent (depende de qué persiste primero). Contradice el §16. Es pérdida de producto **reproducible**, no estocástica.
2. **(Alto, estocástico) Yield del extractor: 2/9 passes.** El composite aparece ~22% de las veces sobre evidencia de walking-tour. Es el techo de todo lo demás.
3. **(Medio) Sin loop de calidad de tour.** "Verificado" ≠ "buen tour"; el extractor aún emite ruido (Baloon, La Hazana, Isidoro Cañones, Princess) que resuelve pero no pertenece al intent.
4. **(Medio, estructural) 124 llamadas de routing Geoapify por run** en COLD 1 y WARM (travel-times del planner recomputados, no cacheados). El reuso de catálogo no ahorra routing.
5. **(Bajo/medio) Re-ataque de resoluciones fallidas**: WARM re-consultó el OSM pool para 3 hints conocidos-no-resueltos (los fallos no se recuerdan). Sin "negative caching".

---

## HISTORICAL PROBLEMS THAT ARE NO LONGER CURRENT

1. **`required` LLM-owned descartando composites** — resuelto (Stage 2/4). Ahora la admisión es "full source composition".
2. **`NO_OSM_MATCH` falso enmascarando fallos** — **resuelto en Stage 5** (trace fidelity: PROVIDER_FAILURE, CANDIDATE_REJECTED, extractor_envelope_unrecognized). Este era mi hallazgo del `trace-failure-semantics.spec.ts` untracked; ahora es 15/15.
3. **`ExperienceComponent.order` nunca null** — resuelto (Stage 4: `order NULL` cuando no hay secuencia).
4. **F2 (route_like → GENERIC)** — resuelto (`acquisition-strategy-selector.util.ts`: route_like → AREA_ROUTE_WALK con un anchor).
5. **"No se produce un composite live"** — superado (COLD 1 persistió + seleccionó).
6. **F1 (Google Places radius >50km)** — probablemente mitigado por switch a Geoapify + `clampRadius`; **no re-verificado** contra Mendoza (sigue abierto como gap de evidencia, no como bug confirmado).

---

## CURRENT ARCHITECTURAL DISAGREEMENTS

1. **El dedupe Gate 1 contradice el §16 del amendment.** No es un bug de Stage 5: es una colisión entre dos políticas canónicas. El dedupe usa "shared component" como señal de *posible duplicación de identidad*, pero el modelo de dominio dice que compartir un GeoEntity **no** es duplicación (un standalone "Visit Plaza Dorrego" y un "San Telmo Walk" que lo contiene son dos Experiences distintas). El artefacto de cardinalidad (`Math.max`) lo agrava: un composite de 2 stops que comparte 1 venue "es 50% igual" a ese venue — lo cual no es semánticamente cierto. **Mi posición independiente**: hay que corregir la *señal* (component overlap no debería, por sí solo, disparar AMBIGUOUS contra un standalone que comparte una entidad), no simplemente bajar el threshold. La decisión es de política de identidad de Experience, no de "relajar" un guard.

2. **El milestone se cerró con 1 unit + 3 integration tests en rojo "baseline".** El test unitario es `preference-first-architecture.spec.ts` (regex sobre texto fuente, falla por `destinationBoundary` en resolver:613). Sigo sosteniendo que un test de arquitectura por regex que falla de forma permanente erosiona la señal del suite y es frágil por diseño (un rename legítimo rompe el "contrato"). Es la única mancha en una disciplina de validación por lo demás excepcional.

3. **`Tour.metadata.generationStatus` como lifecycle state en JSON** sigue siendo mi desacuerdo de typed-boundary más firme (participa del state machine, se consulta/actualiza repetidamente). La clasificación (con shape guard) y el trace (audit snapshot) están bien en JSON; el estado de generación merece columnas.

---

## DISCOVERY / EXTRACTOR REASSESSMENT

Descomposición precisa (ya no "extractor variance" como bucket único):

- **A (no produce composites)**: SÍ — 7/9 passes devolvieron 0 candidatos sobre evidencia válida de walking-tour. **Es el modo dominante**.
- **B (produce pero componentes varían)**: SÍ — {Lezama, Plaza Dorrego} (COLD 1) vs {Plaza Dorrego, Mercado} (COLD 4).
- **C (partial específicamente estocástico)**: **NO observado** live (ningún partial en 4 COLDs). El invariant sigue validado solo en unit/Postgres.
- **D (calidad de candidato varía)**: SÍ — ruido recurrente (Baloon, La Hazana, etc.) que resuelve pero no pertenece al intent.
- **E (evidencia provider varía upstream)**: SÍ — la evidencia web (GuruWalk/Tripadvisor/free-walk) varía por run.

**Conclusión**: el cuello no es la identidad (resuelta) ni la geografía (resuelta). Es **fiabilidad de extracción (A, 22% yield) + un dedupe falso-positivo (nuevo)**. Ambos son upstream/identity-adjacent, y ambos son ahora medibles.

---

## SIMPLE / COMPOSITE / MIXED REASSESSMENT

- **SIMPLE (Buenos Aires art)**: funciona, catalog-reuse probado (18/18 warm).
- **COMPOSITE (Luján de Cuyo wine)**: falló en 4/4 runs históricos (F1+F2). F2 corregido, F1 probablemente mitigado, pero **nunca re-spikeado**. Sigue sin evidencia de que una ruta *regional/rural* se materialice.
- **MIXED**: mismo bloqueador destination-driven.

**Gap de producto que permanece**: el único composite probado live es una *caminata urbana* (San Telmo). La pregunta "¿sirve el pipeline para rutas de bodegas/regionales?" sigue **sin responder**, no por bug confirmado sino por **ausencia de evidencia**.

---

## TOUR QUALITY REASSESSMENT

Se mantiene, con evidencia precisa:

- COLD 1 seleccionó el composite como order 1 (progreso real), pero el tour también contiene ruido resuelto (Baloon, La Hazana).
- **No hay señal de calidad del resultado**: los tests prueban correctness (identidad/geografía/no-duplicación), no relevance/diversity/subsumption sobre corpus etiquetado.
- **No atribuyo al planner**: el planner selecciona correctamente lo que le llega; el problema está en el discovery (alimenta ruido) y en la selección (sin señal para filtrarlo).
- Distingo: identity correctness (bien), Experience relevance (sin evaluar), portfolio composition (overlap filter existe, no diversidad semántica), planner quality (correcto), user satisfaction (sin señal).

---

## PERFORMANCE: STRUCTURAL VS ENVIRONMENTAL

### Structural

- **Fanout serial por componente** (catalog → observation → OSM/Nominatim/Places → Wikidata por hint), multiplicativo.
- **124 llamadas de routing Geoapify por run** (planner travel-times recomputados, no cacheados). Medible y recurrente.
- **Re-ataque de resoluciones fallidas** en WARM (sin negative caching).
- Retry del outbox + reconciliación de fallo terminal (bien).

### Environmental

- Free-tier Groq/Gemini (429/OTPM degradó clasificaciones en COLD 2/WARM); local Nominatim/Overpass/Postgres/Ollama; `AI_CACHE_MODE=off`/`USE_MOCK_MAPS=false` para tests; timeouts dev. El número absoluto COLD ~300s está dominado por esto.

### Unknown / needs production-shaped benchmark

- Latencia real cold con providers de producción y routing cacheado.
- Si las 124 llamadas de routing son aceptables o deben precomputarse/cachearse.
- Costo real del fanout Wikidata/Places a escala.

---

## IDENTITY / GEOGRAPHY REASSESSMENT

**Después de Stage 3–5, retiro mi desacuerdo anterior**: identidad/geografía es fundacional y **probada** (El Zanjón `osm:node:9953027884` vía 2 paths de convergencia + verified hint en WARM; Solar de French; 0 duplicados; WARM 0 llamadas de identidad). Mi claim de "sobre-inversión" era incorrecto.

**Lo que sigue válido**:

- `verifiedHintNames`: riesgo de **estancamiento** (append-only sin invalidación), no de crecimiento por request. Un VERIFIED erróneo se congela.
- `representativePoint` MultiPolygon usa solo el primer polígono (inconsistente con `spatial-footprint` que aplana todos). Menor.
- **La validación** maneja MultiLineString; **el planner footprint** no. Dos cosas distintas (antes las mezclé).

---

## DATA / FRESHNESS / CORRECTION REASSESSMENT

- **Nuevo y concreto**: los fallos de resolución de identidad **no se recuerdan** (WARM re-consultó OSM pool para 3 hints conocidos-no-resueltos). Falta un "negative cache" / TTL de fallos. Es distinto de freshness (positiva); es un gap de *no-reintento* que cuesta llamadas y latencia en WARM.
- **`verifiedHintNames`**: sin lifecycle/invalidación (append-only tras VERIFIED externo).
- **`metadata`** separado: `generationTrace`/`executionSummary` = audit snapshot (OK en JSON); `classification` = shape guard + versionado (OK-ish); `generationStatus` = lifecycle state (debería ser columnas).
- **`required` columns**: vestigiales, listas para drop (schema.prisma:102,303).

---

## MAINTAINABILITY REASSESSMENT

- **God services** (resolver 2816, generation 2153 líneas): señal real, no prueba de mal acoplamiento. El dominio está bien comentado y las boundaries son conceptualmente claras. **Recomendación: `leave until behavior stabilizes`** (el milestone acaba de cerrar; el dedupe finding puede tocar la costura de identidad/dedupe, no de orquestación). Reevaluar refactor tras la decisión de dedupe.
- **Test de arquitectura por regex** (`preference-first-architecture.spec.ts`): sigue en rojo baseline. Recomendación: arreglar el `destinationBoundary` (naming residual, no violación real) o migrar a dependency-cruiser/import-guard. Un test rojo permanente es peor que ninguno.
- **`trace-failure-semantics.spec.ts`**: ahora trackeado y 15/15. Resolvió exactamente la deuda que señalé en el primer reporte. Bien.
- **metadata**: ver arriba.

---

## STAGE 5 RECOMMENDATION

**La decisión ya fue tomada correctamente**: cerrar Stage 5 era lo correcto, y así se hizo. El milestone cierra con:

- la validación live que faltaba (composite persistido + seleccionado; planner-boundary = PERSISTED);
- la fidelidad de trace completa;
- un **OPEN FINDING (dedupe)** correctamente **diferido como decisión de política de identidad**, no plegado a Stage 5 ("would change existing identity policy, so it is reported instead of folded").

No habría interrumpido nada. La disciplina de "reportar el finding en vez de cambiarlo inline" es exactamente el comportamiento correcto en una política de identidad que ya pasó 4 rondas adversariales.

---

## RECOMMENDED NEXT PHASE AFTER STAGE 5

Comparo alternativas y elijo un bloque coherente:

- **A (más identity/geographic hardening)** → **No.** Ya probado suficiente; añadiría complejidad sin mover producto.
- **B (discovery/composite/shape reliability)** → **Sí, en parte.** El yield 2/9 es el techo #2.
- **C (tour quality / selection)** → **Sí.** Sin loop de calidad, no hay forma de saber si el producto es bueno.
- **D (performance characterization)** → Parcial: solo el routing 124/run merece medición ahora; el resto es ambiental.
- **E (data freshness / correction lifecycle)** → Incluir el *negative cache* de fallos (barato y resuelve el WARM re-ataque).
- **F (refactor)** → No ahora.

**Bloque propuesto (un solo milestone coherente):**

1. **Decisión de política de dedupe** (el OPEN FINDING). Es el risk #1 y es determinístico: está descartando composites válidos y standalones legítimos. La señal correcta no es "relajar el threshold", es hacer que "compartir un GeoEntity" deje de disparar AMBIGUOUS contra un standalone (alinear el dedupe con el §16: membership ≠ standalone authority). Es un cambio de política con pruebas adversariales, no un patch.
2. **Elevar el yield del extractor** (B): instrumentar "candidato producido / evidencias disponibles" y estabilizar la extracción de composites (hoy 2/9).
3. **Corpus de calidad de tour** (C): etiquetar ~20-30 tours bueno/malo para calibrar relevance/diversity y filtrar ruido.
4. **Negative cache de fallos** (E): recordar resoluciones fallidas para no re-consultar OSM en WARM.

Esto resuelve problemas de producto concretos y usa la infraestructura ya validada como base.

---

## THINGS I WOULD STILL NOT WORK ON YET

1. **Más estados/hardening de identidad** — suficiente; el próximo problema es dedupe-policy, no más capas.
2. **Refactor de god-services** — esperar a que la decisión de dedupe estabilice el dominio de identidad.
3. **Más grounded-search providers / caracterización Serper-vs-SerpApi-vs-Tavily** — decidir uno y congelar.
4. **MultiLineString planner footprint** — deuda real pero **no ejercitada live** (ningún ROUTE GeoEntity en 5 runs). Postergable hasta que un route real lo requiera.
5. **POINT_RADIUS para líneas/polígonos, NEAR threshold, ratio de partial** — todos `NOT SELECTED` por falta de evidencia; postergar correctamente hasta que haya datos.
6. **Migración del `Tour` legacy / `required` columns** — bajo impacto, salvo que se toque el dominio de identidad.
7. **Mendoza COMPOSITE/MIXED re-spike** — no es "no trabajar"; es "requiere una decisión previa": solo tiene sentido *después* de la decisión de dedupe (para no confundir la señal) y de subir el yield del extractor (para no re-coleccionar el mismo fallo).

---

## REVISED THREE THINGS THE TEAM MAY BE UNDERESTIMATING

1. **El dedupe no es un edge-case: es una contradicción de diseño entre dos políticas canónicas.** `setOverlap` (división por `Math.max`) convierte "compartir un GeoEntity" en "50% idéntico" y, vía el cutoff 0.5 de `componentOverlap`, dispara AMBIGUOUS. El resultado no depende de la identidad sino del **orden de persistencia** (COLD 1 perdió un standalone; COLD 4 perdió un composite completo). Esto contradice el §16 que el propio equipo escribió ("membership ≠ standalone authority"). El equipo lo clasifica correctamente como "policy decision", pero puede estar subestimando que **no es un ajuste de threshold**: es alinear la *señal* del dedupe con el modelo de dominio, y hasta que no se haga, el sistema está descartando exactamente las experiencias que acaba de aprender a producir. Es el risk #1 de producto, y es determinístico.

2. **El yield del extractor (2/9) es el techo real, y no es "varianza" genérica sino una bimodalidad con causa probablemente fijable.** En 7 de 9 passes el extractor devolvió 0 candidatos sobre evidencia válida de walking-tour. Todo el pipeline downstream es ahora correcto y predecible; el único punto estocástico sin controlar está en el paso 1. Si esto se estabiliza, el valor del milestone entero se multiplica; si no, los composites seguirán apareciendo ~1 de cada 4 veces sin importar cuán perfecta sea la identidad/geografía.

3. **El "reuso warm" no cubre todo lo que el equipo cree.** El catalog-reuse eliminó las llamadas de identidad en WARM (0 Wikidata, 0 Places details) — excelente. Pero (a) el planner sigue recomputando **124 llamadas de routing Geoapify** por run, idéntico a COLD; y (b) los **fallos de resolución se re-ataquen cada run** (WARM re-consultó OSM pool para 3 hints conocidos-no-resueltos). El ahorro de "reuso" se mide en identidad, no en routing ni en fallos; el costo recurrente dominante a escala podría no estar donde se optimizó.

---

### Nota de verificación

Reconfirmé `fork/feat/preference-first-selection` = `de99eaf` (igual a HEAD local, árbol limpio). Verifiqué en código: `setOverlap` (`experience-dedupe.util.ts:406-410`), cutoff `componentOverlap >= 0.5` → AMBIGUOUS (línea 190), `representativePoint` (resolver:2780-2816), `spatial-footprint` sin branch MultiLineString, `area-scope-membership-policy` sí maneja MultiLineString (líneas 190/251), `acquisition-strategy-selector.util.ts` routea route_like→AREA_ROUTE_WALK, `clampRadius` (`catalog-refill-anchor-planner.service.ts:248`), San Martín solo en comentarios, `required` columnas en schema.prisma:102/303, y el test baseline `preference-first-architecture.spec.ts` sigue fallando por `destinationBoundary` (resolver:613). No corrí el test suite (evito fabricar resultados de validación); toda afirmación está respaldada por lectura directa de código en HEAD y por los `assessment.md`/`summary.md`/`comparison.md`/Progress citados.
