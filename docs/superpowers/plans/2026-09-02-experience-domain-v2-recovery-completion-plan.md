# Experience Domain V2 — plan de recuperación y finalización

**Repositorio:** `jiseruk/zig-zag`  
**Branch de trabajo:** `feat/experience-domain-v2`  
**Base histórica:** `feat/geographic-validation-outbox-media-hardening`  
**Plan arquitectónico vinculante:** `docs/superpowers/plans/2026-09-01-experience-domain-v2-tour-generation-rearchitecture.md`  
**HEAD auditado al redactar este plan:** `e7e739961b231a789b5c4fecb0721749f5545dda`  

> Este documento es un plan de recuperación. No reemplaza los invariantes arquitectónicos del plan original; agrega correcciones, orden de ejecución, pruebas y gates de cierre. Si el HEAD cambió, primero hay que repetir el inventario y actualizar la matriz de divergencias.

## Instrucción para Codex

Implementá este plan completo sobre `feat/experience-domain-v2`. No trates el trabajo como un rename de `Activity` a `Experience`. El objetivo es demostrar, mediante contratos, pruebas y ejecuciones observables, que el flujo V2 funciona de punta a punta.

No declares la tarea terminada porque compile, porque existan las clases o porque un Tour haya llegado a `completed`. Un bloque sólo está completo cuando pasan sus pruebas normales, degradadas y de regresión, y la Bitácora demuestra las decisiones reales.

Avanzá de checkpoint en checkpoint sin pedir aprobación intermedia, salvo que:

- el HEAD ya no corresponda con el estado descrito;
- una divergencia cambie un invariante del dominio;
- haga falta una credencial, un servicio externo o una decisión de producto no definida;
- una migración destructiva no pueda probarse de forma segura.

En esos casos, detenete, documentá evidencia concreta y pedí la decisión mínima necesaria. No inventes el comportamiento.

## Resultado obligatorio

Al finalizar debe ser cierto que:

1. Todo elemento planificable es una `Experience` persistida y el Tour conserva snapshots mediante `TourExperience`.
2. `GeoEntity` sólo representa `PLACE | AREA | ROUTE` y está separado de `Experience`.
3. El planner y el ranking final son determinísticos. Ningún LLM ordena ni arma el Tour.
4. Se consulta primero el catálogo local verificado. Search/discovery externo se usa sólo para déficits concretos de coverage.
5. Ninguna salida libre del LLM se persiste sin extracción tipada, resolución, evidencia y validación geográfica.
6. La adquisición del catálogo puede ejecutarse desde administración sin crear un Tour.
7. Las preferencias en texto libre se interpretan con LLM, pero se aplican de manera determinística y auditable. Nunca son hard gates absolutos.
8. Las escapadas/day trips son discovery origin-bound con destino abierto, restricciones de ida/vuelta y política explícita de pernocte.
9. Se preservan async, outbox, queue, idempotencia, retries y enriquecimiento de media.
10. De imágenes sólo se persisten URLs y su procedencia/estado; nunca binarios ni un proxy nuevo de fotos de Google.
11. Bitácora V3 registra prompts exactos, schemas, raw responses, queries, evidence, decisiones, rechazos, timings y attempts, con secretos redactados centralmente.

## Reglas no negociables

- No confiar en coordenadas, IDs de proveedor ni afirmaciones geográficas producidas por un LLM.
- Separar estrictamente `extract → resolve → validate → dedupe → persist`.
- Routing evalúa factibilidad; no convierte una propuesta sin evidencia en válida.
- Un `ROUTE` puede validarse con geometría canónica o con componentes resueltos y coherentes.
- Una Experience venue-centric puede tener un solo venue. Una Experience inherentemente multi-componente necesita al menos dos componentes coherentes.
- La ausencia de evidencia no es lo mismo que un fallo transitorio del proveedor.
- Dedupe debe ser conservador: una duda es `AMBIGUOUS`, no `SAME`.
- No implementar “city plus surroundings”. Day trips es un flujo separado, origin-bound/open-destination.
- No añadir Google Places photo proxy ni ranking bonus por foto.
- No reescribir outbox/media que ya funcionan; corregir sólo lo demostrado por tests o por la auditoría.
- No borrar compatibilidad o datos legacy adicionales hasta que todos los gates de cutover sean verdes.
- No esconder un stage requerido con `catch` no fatal. Si se degrada, la salida y la Bitácora deben decir exactamente qué ocurrió.

## Checkpoint 0 — inventario reproducible del HEAD

Antes de editar:

1. Registrar branch, SHA, status, diff contra la base y migraciones presentes.
2. Leer completos `AGENTS.md`, el plan arquitectónico y `docs/architecture/activity-discovery-and-tour-generation.md`.
3. Verificar si existe `.codegraph`; usar CodeGraph si está disponible y documentar su ausencia si no.
4. Confirmar que cualquier reset de base de datos usado por tests sea seguro y esté aislado.
5. Inventariar símbolos y archivos de:
   - async/outbox/queue/idempotencia/retries;
   - media y persistencia de URLs;
   - trace/Bitácora/redaction;
   - discovery/extraction/resolution/validation;
   - dedupe/materialización/embeddings;
   - coverage/acquisition/ranking/preferences;
   - planner/routing/snapshots;
   - admin population y day trips.
6. Ejecutar baseline de typecheck, unit tests, build e integración. Registrar cada fallo preexistente; no neutralizarlo excluyendo tests.
7. Crear una tabla `invariante → implementación actual → divergencia → checkpoint dueño`.

**Gate:** inventario y baseline adjuntos al reporte de ejecución. Si una divergencia cambia el dominio, detenerse antes de editar.

## Checkpoint 1 — reparar el harness y fijar contratos V2

Primero hacer que los tests compilen y que prueben el contrato actual:

- Corregir acceptance tests que importan `ExperienceFormat`, `Activity`, `activityId`, `entityHints` o utilidades eliminadas.
- Asegurar que los tests de aceptación sean descubiertos por un comando de CI explícito; no depender del `rootDir` de Jest que sólo cubre `src`.
- Eliminar la doble registración de `ExperienceDiscoveryPlannerService`.
- Crear fixtures canónicos compartidos para `ExperienceCandidate`, `ComponentHint`, `ResolvedComponent`, `GeographicValidationResult`, `DedupeDecision` y `PlanningCandidate`.
- Agregar tests de contrato para Gemini y Groq contra el mismo schema canónico.

El contrato de extracción debe usar un único envelope y un único vocabulario. La respuesta estructurada, el prompt y el extractor deben coincidir exactamente; como mínimo cada candidate debe incluir:

- `canonicalName`, `description`, `themes`, `traits`;
- `componentHints[]` con rol, nombre y evidencia solicitada;
- información de procedencia separada del contenido del candidato.

No debe existir en ese flujo ninguna mezcla con `proposals`, `kind` estructural o `entityHints` legacy.

**Gate:** typecheck, unit tests y contract tests verdes; un payload válido de cada proveedor produce candidatos y un payload inválido falla de forma tipada y auditable.

## Checkpoint 2 — vertical slice de discovery fundamentado

Reparar primero el camino completo de una propuesta antes de ampliar features:

`coverage deficit → focused query → raw provider response → extraction → component resolution → geographic validation → dedupe → persistence → local requery`.

Requisitos:

- El adapter de cada proveedor devuelve prompt exacto, response schema, raw response, modelo, tokens si existen, attempt, timestamps y error tipado.
- `extractExperienceCandidates` consume exactamente el schema del checkpoint 1.
- `CompositeGeographicValidationService` recibe `componentHints`; no accede a campos legacy.
- Un error del proveedor, una respuesta vacía, una extracción inválida y cero matches son resultados distintos.
- Si discovery era requerido para cubrir un déficit y falla, no marcar silenciosamente la etapa como exitosa. Se puede continuar degradado sólo si el contrato del Tour lo permite, dejando el déficit sin cubrir explícito.
- Agregar tests unitarios y un integration test que materialice una Experience verificada y la encuentre en el requery local.

**Gate:** el caso San Telmo genera una propuesta multi-componente válida desde discovery fundamentado, la persiste y luego la recupera desde el catálogo; la Bitácora permite reconstruir el flujo sin mirar logs del servidor.

## Checkpoint 3 — resolución y coherencia geográfica

Implementar un resolver real por tipo:

- `PLACE`: resolver mediante fuentes confiables configuradas (por ejemplo Places/OSM), sin aceptar IDs o coordenadas del LLM.
- `AREA`: persistir geometría canónica y un point/centroid utilizable.
- `ROUTE`: persistir geometría canónica o componentes ordenables y coherentes; calcular point/centroid cuando corresponda.
- Persistir `latitude/longitude` además de geometry cuando el modelo lo requiera; no perder las coordenadas derivadas durante `upsertGeoEntity`.
- Preservar el orden de componentes sólo cuando existe evidencia de orden intrínseco. Si no, dejarlo semánticamente no ordenado.
- Mantener el contrato de boundary como request object y distinguir `provider failure`, `query empty` y `no match`.
- Mantener point-radius como geometría sintética válida y documentada.

Casos de regresión obligatorios:

- Sevilla no puede recentrarse incorrectamente por usar un bbox ambiguo.
- `ROUTE` por geometría y `ROUTE` por componentes coherentes.
- Experience venue-centric con un componente.
- Experience multi-componente con menos de dos matches debe rechazarse.
- Overpass `429`, timeout y cero resultados deben producir estados diferentes.

**Gate:** tests normales y degradados verdes para PLACE/AREA/ROUTE, incluida persistencia y relectura de geometry/point.

## Checkpoint 4 — dedupe conservador y race-safe

Reemplazar el booleano implícito por un resultado explícito:

```ts
type DedupeDecision =
  | { decision: 'SAME'; canonicalExperienceId: string; evidence: DedupeEvidence }
  | { decision: 'NEW'; evidence: DedupeEvidence }
  | { decision: 'AMBIGUOUS'; candidates: DedupeCandidate[]; evidence: DedupeEvidence };
```

Requisitos:

- Combinar identidad semántica, componentes/roles, geografía, procedencia y señales estructurales; no usar sólo nombre exacto + un componente compartido.
- `AMBIGUOUS` no crea alias destructivo ni fusiona automáticamente.
- `SAME` enriquece evidencia, traits, metadata y URLs sin borrar información mejor; reindexa si cambia el documento semántico.
- Proteger carreras con constraint/transaction/upsert/retry verificable.
- No limitar silenciosamente la búsqueda a 100 filas globales sin una estrategia indexada y localizada.

**Gate:** pruebas de NEW, SAME con enriquecimiento, AMBIGUOUS, falsos amigos con componente compartido y dos writers concurrentes.

## Checkpoint 5 — documentos semánticos, embeddings e índices

- Definir una única función pura y testeada que construya el documento semántico de una Experience.
- Generar/enqueue embedding al crear o enriquecer materialmente una Experience.
- Implementar rebuild idempotente y observable para filas faltantes o desactualizadas.
- Crear el índice vectorial/HNSW correcto sobre Experience; eliminar la migración que restaura un índice de Activity sólo después de probar el reemplazo.
- No registrar “embedding exitoso” si el vector no fue persistido.
- Hacer que un fallo del proveedor deje estado retryable y visible, sin impedir fallback determinístico lexical/estructural.

**Gate:** creación, actualización, retry y rebuild probados; query semántica recupera Experiences V2; ningún índice productivo apunta a Activity.

## Checkpoint 6 — coverage local-first y adquisición enfocada

Coverage debe medir relevancia, no sólo cantidad:

- Calcular déficits por intent/theme/trait/geografía/duración necesarios para la solicitud.
- Un catálogo numeroso pero irrelevante sigue teniendo déficit.
- Un catálogo maduro y relevante no llama proveedores externos.
- Convertir déficits relevantes —incluidos tango y long-tail— en queries enfocadas; no hacer refill genérico como sustituto.
- Hacer que `acquireNearbyAsExperiences` use realmente intereses/intents en las queries y no sólo en metadata.
- Tras persistir, volver a consultar catálogo, recalcular coverage y registrar el delta.
- Definir budgets y límites por request para evitar fan-out ilimitado.

**Gate:** Mendoza madura se resuelve local-only; Mendoza numerosa pero irrelevante dispara discovery enfocado; tango y un interés long-tail obtienen coverage verificable o un déficit explícito.

## Checkpoint 7 — preferencias determinísticas y traits

Mantener LLM sólo para interpretar texto libre. Después:

- Persistir/tracear interpretación tipada con positivos, negativos, restricciones suaves y ambigüedades.
- Aplicar scoring/penalties determinísticos; ninguna preferencia blanda vacía el conjunto por completo.
- Evaluar nombre, descripción, themes, traits y GeoEntities/componentes requeridos. No usar `JSON.stringify(...).includes(...)` como motor de reglas.
- Integrar dietary restrictions, budget, group, accessibility y demás campos existentes con reglas explícitas.
- Conectar `traitDefinitionIds` durante adquisición/resolución/materialización para que las relaciones no queden siempre vacías.
- Registrar contribuciones de score y relajaciones aplicadas.

**Gate:** preferencia religiosa negativa detecta un componente religioso aunque el nombre de la Experience no lo diga; positivos, dieta, accesibilidad y fallback sin candidatos tienen tests determinísticos.

## Checkpoint 8 — ranking, routing y planner determinísticos

- Mantener `GreedyDailyPlanningSolver` sin LLM.
- Normalizar todos los componentes relevantes; no colapsar cada Experience al primer point.
- Incorporar routing interno para Experiences multi-componente y routing externo entre Experiences.
- Usar un provider real configurable con fallback explícito a estimación aproximada.
- Revalidar opening hours después de cualquier reorder.
- Eliminar vocabulario legacy (`areaId`, `activityId`, redundancias de Activity) del contrato V2.
- Mantener routing fuera de la verificación geográfica.
- Registrar internal routing, external routing, fallback usado, matriz/costos y rechazos.

**Gate:** mismo input canónico produce el mismo Tour; downtime de routing activa fallback sin cambiar una Experience de inválida a válida; opening hours siguen válidos después del orden final.

## Checkpoint 9 — media con persistencia de URLs

- Agregar el modelo persistente necesario para URLs de imágenes, proveedor/procedencia y estado.
- `MediaEnrichmentProcessorService` debe guardar las URLs retornadas; no sólo actualizar `mediaStatus`.
- El consumidor no puede aceptar como éxito un evento que nadie persiste.
- Preservar taxonomía: `RETRYABLE_FAILURE` para red/429/5xx; authoritative empty con negative cache; no negative-cachear fallas transitorias.
- Hacer idempotentes el merge y la actualización.
- La presentación debe leer las URLs realmente persistidas. Un fallback visual estático no cuenta como enriquecimiento.
- Nunca descargar ni persistir binarios.

**Gate:** success persiste y presenta URLs; authoritative empty usa cache; 429/5xx reintenta; replay no duplica; cero blobs almacenados.

## Checkpoint 10 — async, outbox, idempotencia y retries

Conservar la creación atómica de `Tour + TourGenerationRequested` y reparar la semántica de consumo:

- Un error transitorio de generación no puede dejar Tour en `failed` de forma que el redelivery se convierta en no-op y el outbox termine publicado.
- Modelar estados retryable/terminal, attempt, lease y backoff de forma explícita.
- `completed` duplicado es no-op idempotente.
- Un `generating` interrumpido se recupera sin duplicar snapshots.
- Definir retry manual sólo si existe endpoint/job real, autorizado y testeado; no documentar una API inexistente.
- La queue in-memory puede estar detrás de un outbox durable para desarrollo, pero esa degradación debe ser explícita y no confundirse con delivery durable end-to-end.

**Gate:** pruebas de crash antes/después de persistencia, redelivery, duplicate delivery, retry exhaustion y recuperación de lease.

## Checkpoint 11 — Bitácora V3 real

Crear schema/version V3 y dejar de etiquetar traces legacy como si fueran V3. Debe registrar, con redacción recursiva centralizada:

- request canónico e interpretación de preferencias;
- decisión de catalog search y resultados relevantes;
- coverage antes/después y déficit que justificó cada búsqueda;
- query exacta, proveedor, modelo, prompt, schema, raw response, tokens si existen, attempt y timing;
- extracción y motivos de descarte;
- resolución por componente y evidence refs;
- validación geográfica y rechazos;
- dedupe `SAME | NEW | AMBIGUOUS` y enriquecimiento;
- persistencia, embedding y requery;
- ranking con contribuciones de score;
- routing interno/externo y fallback;
- planner, snapshots y resultado final;
- errores transitorios vs terminales.

`executionSummary` debe ser estructurado y derivado de eventos reales, no concatenación de summaries. Corregir el mismatch que hoy hace que geographic validation figure como “not recorded” aunque haya corrido.

Agregar golden tests de redaction para API keys, auth headers, tokens, DSNs, cookies y secretos anidados. El prompt Wikidata con llaves JSON debe compilar/renderizarse correctamente.

**Gate:** para una ejecución local-only, una con discovery y una degradada, un revisor puede reconstruir por qué cada Experience quedó o fue rechazada sin consultar logs externos ni secretos.

## Checkpoint 12 — population administrativa

Implementar un entrypoint administrativo autenticado —controller/job/CLI acorde al patrón del repo— que:

- reciba un scope geográfico e intents/themes;
- cree un job persistente e idempotente;
- ejecute adquisición bounded y reanudable vía outbox/queue;
- materialice y enriquezca Experiences sin crear Tour;
- exponga lifecycle, counts, errores, retries, coverage delta y métricas;
- evite fan-out ilimitado sobre áreas amplias.

**Gate:** population de Mendoza aumenta coverage del catálogo, no crea Tour, puede reintentarse y no duplica Experiences.

## Checkpoint 13 — day trips / escapadas

Extender backend, contrato HTTP y frontend con un scope explícito, por ejemplo `origin_bound_open`, que incluya:

- origen resuelto;
- destino abierto;
- máximo de traslado de ida y vuelta;
- restricciones horarias de salida/regreso;
- política same-day versus overnight;
- interests/preferences canónicos.

Discovery busca Experiences/destinos compatibles desde el origen; no simula “destino + surroundings”. Ranking y planner incorporan outbound, experiencia en destino y return. Overnight sólo se admite cuando el request lo habilita.

**Gate:** una escapada same-day respeta el regreso; una overnight incluye pernocte sólo cuando está permitido; ambas son determinísticas después de discovery y quedan auditadas.

## Checkpoint 14 — cutover, documentación y limpieza

Sólo después de que los checkpoints anteriores estén verdes:

- Actualizar `docs/architecture/activity-discovery-and-tour-generation.md` al paradigma Experience V2.
- Corregir README y diagramas que mencionan servicios/prompts Activity eliminados.
- Eliminar aliases y comentarios Activity residuales, incluidos `@activities`, `source: poi|composite` si ya no representan el dominio y nombres legacy del planner.
- Revisar migraciones desde una base limpia y desde el estado de base soportado. Documentar irreversibilidad y backup si aplica.
- Confirmar que no quedan lecturas/escrituras runtime de Activity.
- No ampliar el alcance con funcionalidades no pedidas.

**Gate:** documentación coincide con el runtime, migraciones reproducibles, búsqueda de símbolos legacy explicada y CI verde.

## Matriz de aceptación obligatoria

Estos 18 escenarios son release gates. “Pasa” exige assertions sobre datos persistidos y Bitácora, no sólo HTTP 200 o Tour `completed`.

| ID | Escenario | Resultado exigido |
| --- | --- | --- |
| A01 | Experience simple PLACE desde fuente confiable | Experience y GeoEntity persistidas; TourExperience snapshot; evidencia y URL media trazables. |
| A02 | Paseo multi-componente de San Telmo | Discovery fundamentado, 2+ componentes coherentes, materialización y requery local. |
| A03 | Dos recorridos oficiales parecidos | Dedupe no los fusiona salvo evidencia SAME; AMBIGUOUS queda conservador. |
| A04 | Gualeguaychú | Genera Tour sin structural-kind gate y sin depender de Activity. |
| A05 | Falta coverage de tango | Query enfocada y coverage recalculado; no refill genérico. |
| A06 | Propuesta SAME con evidencia nueva | Enriquece la Experience canónica, no duplica y reindexa si corresponde. |
| A07 | Point-radius | Continúa con geometría sintética válida y auditable. |
| A08 | Routing provider caído | Usa fallback explícito; no altera verificación geográfica. |
| A09 | Media provider con fallo transitorio | Retry sin negative cache y sin perder el job. |
| A10 | Media authoritative empty | Negative cache con TTL/política; no reconsulta inmediatamente. |
| A11 | Entrega duplicada de generación | No duplica TourExperience ni efectos secundarios. |
| A12 | Bitácora V3 de corrida con discovery | Contiene prompt/schema/raw/query/evidence/decisiones/rechazos/routing con secretos redactados. |
| A13 | Preferencia libre conflictiva | Interpretación LLM; aplicación determinística sobre Experience y componentes; relajación auditable. |
| A14 | Population admin Mendoza | Puebla catálogo sin Tour, bounded, idempotente y observable. |
| A15 | Mendoza con catálogo maduro y relevante | Resuelve local-only, sin search externo. |
| A16 | Interés long-tail ausente | Déficit temático dispara discovery enfocado o queda explícitamente no cubierto. |
| A17 | Day trip same-day con destino abierto | Respeta origen, outbound, tiempo útil y regreso el mismo día. |
| A18 | Escapada overnight | Pernocte sólo con opt-in; outbound/return y snapshots completos. |

Agregar además regresiones obligatorias para Sevilla/bbox, Overpass 429/timeout, embeddings que no pueden informar falso éxito y prompt Wikidata con JSON braces.

## Comandos y evidencia de verificación

Usar los scripts reales del repo; como mínimo ejecutar y reportar:

```bash
yarn workspace backend run test --runInBand
yarn workspace backend run check
yarn workspace backend run build
```

Además:

- suite de contract/acceptance completa con comando explícito;
- tests de integración con DB y migraciones desde cero;
- tests frontend para contratos day-trip/preferences si cambia la UI;
- E2E determinístico con providers fake/recorded;
- al menos una ejecución real controlada para Gualeguaychú y una para discovery fundamentado, sin convertirla en condición permanente del CI;
- inspección directa de tablas Experience/GeoEntity/TourExperience/media/outbox/jobs y de Bitácora V3.

No usar el E2E live de 30 minutos o una espera infinita como única aceptación. Ningún test se “arregla” relajando assertions que expresan los invariantes.

## Estrategia de commits y PR

- Trabajar con commits coherentes por checkpoint o subresultado verificable; evitar microcommits mecánicos sin valor de revisión.
- No reescribir ni descartar cambios ajenos del worktree.
- Abrir PR contra la base acordada y hacer que CI corra sobre el PR.
- Mantener una checklist con A01–A18 y enlaces a tests/evidencia.
- No marcar merge-ready mientras haya gates rojos, tests skipped sin justificación o stages requeridos que sólo tengan mocks unitarios.

## Formato obligatorio del reporte final de Codex

1. `HEAD inicial`, `HEAD final`, base y resumen del diff.
2. Tabla por checkpoint: estado, archivos principales, tests, evidencia y deuda restante.
3. Tabla A01–A18 con `PASS | FAIL | BLOCKED`; comando/test y evidencia persistida/Bitácora.
4. Comandos ejecutados con exit code; listar skipped y flakes.
5. Migraciones aplicadas y prueba de instalación limpia/upgrade.
6. Ejemplos redactados de Bitácora V3 para local-only, discovery y degradado.
7. Riesgos conocidos y decisiones que requieren maintainer.
8. Confirmación explícita de que no se usó LLM en ranking/planner, no se persistieron imágenes binarias y no se implementó city-plus-surroundings.

Si algún punto no está comprobado, el reporte debe decir `FAIL` o `BLOCKED`; nunca “completado” por inferencia.

## Definición final de terminado

La rama sólo está terminada cuando:

- los 18 escenarios pasan;
- CI/PR está verde;
- migraciones y persistencia fueron inspeccionadas;
- Bitácora V3 prueba el comportamiento real;
- no hay catches silenciosos en stages obligatorios;
- docs y runtime coinciden;
- el maintainer aprueba el cutover.

Hasta entonces, `feat/experience-domain-v2` es una rama de recuperación en progreso, no una implementación completa.
