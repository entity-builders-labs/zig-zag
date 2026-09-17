# Composite Experience Acquisition — Adversarial System Capability Review

Fecha: 2026-09-15
Branch revisado: `feat/preference-first-selection`
HEAD verificado (local == `fork` remoto, sin drift): `02a2c29822ed255e13fcf1b95f73de0289ff816b`
Estado: **NO production code changes. NO commits. NO push.** Script de caracterización temporal creado, ejecutado y borrado (nunca commiteado).

Metodología: no es una re-lectura de San Telmo. Es una corrida real, en vivo, contra Buenos Aires, con 6 temas (`history, food, culture, art, architecture, nature`) × `intent=walk`, usando los mismos servicios de producción (`ExperienceAcquisitionPlannerService.buildAcquisitionPlan` → `ExperienceAcquisitionService.executePlan` → `ExperienceAcquisitionService.materializeExecution` → `ExperienceProposalResolverService.resolve` → `CompositeGeographicValidationService.validate` → `ExperienceClassificationService`), con:

```
AI_PROVIDER=groq
DISCOVERY_EXTRACTOR_PROVIDER=groq
CLASSIFICATION_PROVIDER=groq
GROUNDED_SEARCH_PROVIDER=serpapi
model=qwen/qwen3.8-27b
```

contra Postgres real, Overpass local real (`zigzag-overpass-argentina`), Nominatim local real, SerpAPI real, Groq real. Base de datos NO reseteada (dev compartida) — ver advertencia en §15.

---

## 1. EXECUTIVE VERDICT

**No defiendo el diseño por default.** La corrida real produjo evidencia de al menos **cuatro defectos concretos, cada uno con reproducción independiente en esta misma sesión**, y uno de ellos es lo bastante grave (pérdida silenciosa de datos, sin ningún error reportado) como para explicar por sí solo buena parte de la señal "0 composite Experiences" que motivó esta revisión.

En una corrida de 6 temas contra Buenos Aires:

- **8 candidatos multi-componente reales fueron generados** por el extractor LLM a partir de evidencia real de SerpAPI.
- **1 de esos 8 se perdió en silencio** antes de llegar siquiera a evaluación (bug de parseo de envelope — ver §6/§14 Root Cause #1).
- De los **7 restantes que sí llegaron a materialización, solo 1 fue persistido** como Experience compuesta nueva (`La Boca Historical & Street Art Walk`, 3/3 componentes reales resueltos correctamente).
- **Tasa de éxito real de composición: 1/8 = 12.5%**, no 0% — pero tampoco una capability confiable.

Y, más grave todavía: de los candidatos que SÍ se resolvieron y persistieron (incluyendo single-place), **el 50% de las resoluciones de entidad únicas observadas (8 de 16) son identidades geográficas incorrectas** — algunas ya viven en la base de datos compartida ahora mismo bajo nombres canónicos como `"CE"`, `"B"`, `"Iglesia"` (ver §8). El sistema no solo está perdiendo candidatos: está **corrompiendo silenciosamente parte de lo que sí persiste**, lo cual es categóricamente peor que "unresolved".

**Veredicto arquitectónico: B — la dirección es correcta, pero al menos tres boundaries/contratos concretos necesitan rediseño, no parches locales.** Ver §16 para la justificación completa y por qué no es A (hay contratos ausentes, no solo bugs puntuales) ni C (el pipeline SÍ produjo un composite real, correcto, de punta a punta, en esta misma corrida).

---

## 2. ACTUAL ARCHITECTURE (diagrama real, desde código)

```
PreferenceInterpreterService (LLM, Groq)
        ↓ PreferenceSpec { anchors[], facets[], intents[] }
DestinationResolutionService (Nominatim)
        ↓ DestinationResolution { scale, boundary(OsmCandidate) | point, countryCode }
AreaRouteAnchorResolverService (Nominatim/Overpass) — SOLO para anchors nombrados (San Telmo, etc.)
        ↓ ResolvedAnchor[]
FacetRetrievalService / CoverageAnalyzer (pre-planner) → AcquisitionDeficit[]
        ↓
ExperienceAcquisitionPlannerService.buildAcquisitionPlan(deficits, anchors)
        ↓ ExperienceAcquisitionPlan { sourcePlans: [wikivoyage?, google_places?, web?], evidenceRequirements }
ExperienceAcquisitionService.executePlan(plan)
    ├── wikivoyage → WikivoyageAcquisitionProvider → SourceObservation[] (evidenceType: place|tourism_activity)
    ├── google_places → GooglePlacesAcquisitionProvider → IPlacesApiService (Google o Geoapify según PLACES_PROVIDER)
    ├── StructuredExperienceCandidateSynthesizerService: 1 observation → 1 componentHint (SIEMPRE, mapeo mecánico 1:1)
    ├── StructuredCandidateCorroborationService: dedupe SAME/NEW/AMBIGUOUS entre fuentes estructuradas (identidad, NO composición)
    └── web → ExperienceGroundedSearchProvider (SerpAPI) → evidence[] → ExperienceDiscoveryExtractor (Groq) → ExperienceCandidate[]
                  ↓ candidateSatisfiesEvidenceRequirement (gate: >=2 required non-area hints para MULTI_COMPONENT_EXPERIENCE)
        ↓ ExecuteAcquisitionPlanResult { candidates[], evidence[] }
ExperienceAcquisitionService.materializeExecution(execution, {geographicScope, validationScope?})
        ↓
ExperienceProposalResolverService.resolve()
    for each candidate:
        for each componentHint:
            pool = hint.role==='route' ? streets(within boundary)
                 : hint.role==='area'  ? [boundary]            ← boundary = SIEMPRE el boundary de TODO el destino, nunca el anchor específico del candidato
                 :                       pois(within boundary)
            matchOsmCandidateByName(hint.name, pool)  ← substring bidireccional SIN guardas
                → si no matchea Y hay "destinationAssociationVerified":
                    resolveViaNominatim (global, sin gate geográfico de aceptación, solo de RANKING)
                    → resolveViaPlaces (fallback — MUERTO si PLACES_PROVIDER=geoapify)
        → candidate accepted solo si TODOS los hints required resolvieron
        → persistVerifiedExperience() [dedupe SAME/NEW/AMBIGUOUS + transacción + advisory locks]
        ↓
CompositeGeographicValidationService.validate()
    → containment/coherence sobre el destino completo (NO sobre el anchor específico)
    → NO valida identidad/nombre, solo geometría
        ↓
ExperienceClassificationService (LLM, evidence-only) → themes/intents/traits
        ↓
FinalExperienceResolutionResponse { resolved[], geographicValidation, classification }
        ↓ (de vuelta en ExperienceGenerationService)
catalog reread (findManyByIds) → ExperienceCompositionService (ranking) → GreedyDailyPlanningSolver → Tour
```

Por boundary:

| Boundary | Input | Output | Owner | Provider | Side effects | Failure mode | Fallback |
|---|---|---|---|---|---|---|---|
| Destination resolution | texto libre | boundary OSM o point+radius | `DestinationResolutionService` | Nominatim | ninguno | degrada a point-scale | ninguno más allá |
| Anchor resolution | anchors nombrados | `ResolvedAnchor[]` | `AreaRouteAnchorResolverService` | Nominatim/Overpass | ninguno | `unresolved` explícito | ninguno |
| Acquisition planning | deficits | `ExperienceAcquisitionPlan` | `ExperienceAcquisitionPlannerService` | — (determinístico) | ninguno | plan vacío si no hay ruta | ninguno |
| Grounded search | query | evidence[] | `SerpApiGroundedSearchService` | SerpAPI (real, red) | consumo de quota | `groundingStatus: failed` (**observado en vivo, 1/6**) | ninguno automático |
| Candidate extraction | evidence | `ExperienceCandidate[]` | `GroqDiscoveryProvider` | Groq LLM | consumo de quota, rate limit (**observado, hasta 21s de backoff**) | **envelope shape no validado → 0 candidatos SIN error** (§6) | ninguno |
| Structured synthesis | `SourceObservation[]` | `ExperienceCandidate[]` (1 componentHint c/u, SIEMPRE) | `StructuredExperienceCandidateSynthesizerService` | — | ninguno | estructuralmente no puede producir MULTI_COMPONENT | n/a — by design |
| Component entity resolution | `GeoEntityHint[]` | `ResolvedGeoEntity[]` | `ExperienceProposalResolverService` | Overpass local, Nominatim, Places(muerto) | escribe `GeoEntity` en DB | **substring matching sin identidad → 50% falsos positivos** (§8) | Nominatim→Places, Places **no-op** con Geoapify |
| Geographic validation | resolved entities | accept/reject | `CompositeGeographicValidationService` | — (geometría pura) | ninguno | no detecta identidad incorrecta dentro del boundary | ninguno |
| Materialization | resolved+valid | `Experience` persistida | `ExperienceCatalogService.persistVerifiedExperience` | Postgres | transacción + advisory locks | ninguno encontrado — correcto | dedupe SAME/AMBIGUOUS |
| Classification | Experience + evidence | themes/intents/traits | `ExperienceClassificationService` | Groq LLM | ninguno | rate limit (mismo Groq) | ninguno |

Autoridad:

- **LLM autoritativo en**: interpretación semántica de preferencias, extracción de candidatos (nombre/tema/estructura propuesta), clasificación evidence-only.
- **Determinístico autoritativo en**: geographic scope, entity resolution (una vez que corre), geographic validation, materialization/dedupe, planning.
- **Fuga de semántica provider-específica al domain**: confirmada en dos lugares — `isAreaScaleEligible` (una política pensada para "¿es esto un área administrativa/asentamiento válido?" reusada implícitamente como si respondiera "¿es esto un AREA de dominio válido?", que es una pregunta distinta — ver §7) y el hecho de que `PLACES_PROVIDER=geoapify` apaga silenciosamente una fuente entera sin que ningún nivel superior lo sepa (§5).

---

## 3. EXPECTED ARCHITECTURE VS ACTUAL

La forma de alto nivel (Destination Resolution → Discovery → Entity Resolution → Validation → Materialization → Tour Generation) **coincide** con lo documentado. Las desviaciones reales:

1. **Provider isolation está bien respetada** en general (el extractor nunca inventa coordenadas/IDs — verificado leyendo el prompt y el output real: cero coordenadas inventadas en 8 candidatos observados). Esto NO está roto.
2. **"OSM = geo facts + entity resolution + validation, NUNCA discovery"** se respeta a nivel de diseño (Wikivoyage/web hacen discovery, OSM solo resuelve) — pero la CALIDAD del resolver hace que esa separación no importe: si el resolver no distingue identidad, da igual que la arquitectura tenga la separación correcta.
3. **"Google Places = single-place discovery/resolution"** — en el papel sí. En este entorno real, **está completamente apagado** (`PLACES_PROVIDER=geoapify`, Geoapify no soporta Text Search descriptivo). Esto no es un defecto de diseño, es una brecha operativa activa que invalida silenciosamente parte del diseño documentado.
4. **"Geographic Scope ya resuelto se usa como bias/scope"** — parcialmente falso: el `geographicScope` que llega al resolver es SIEMPRE el del destino completo (Buenos Aires), nunca el anchor resuelto más específico (San Telmo AREA) que la propia arquitectura ya calculó en `resolvedAnchors`. Ese dato existe, está en memoria, y no se usa en este boundary.

---

## 4. COMPOSITE FUNNEL (números exactos, 6 temas, Buenos Aires)

```
raw candidates fed to resolver:           22   (15 structured single-place + 7 web multi-component-admitted)
  └─ web extractedCandidateCount (LLM):   10   (medido) + 1 perdido en parseo (confirmado manualmente) = 11 reales
  └─ web admittedCandidateCount:           7   (pasaron el gate >=2 required non-area hints)
       rejected en ese gate:               3   (100% razón: NO_MATCHING_EVIDENCE_REQUIREMENT — candidatos solo-área)
materialization totalCandidates:          22
materialization accepted (persisted):     13
materialization rejected:                  9
  rejection reasons:
    UNRESOLVED_REQUIRED_COMPONENT:         5
    OSM_QUERY_EMPTY (infra, ver §7):       3
    destination_mismatch (geo, correcto):  1

Composite candidates (>=2 componentHints) específicamente:
  generados por el LLM:                    8   (1 perdido en parseo, nunca evaluado)
  llegaron a materialización:               7
  persistidos como Experience NUEVA:        1   (La Boca Historical & Street Art Walk)
  → tasa de éxito composite: 1/8 = 12.5%

component hints observados:               40   (venue=35, area=4, route=1)
resolved:                                 26
unresolved:                               14   (NO_OSM_MATCH=7, OSM_QUERY_EMPTY=7)
```

Pérdida por transición:

| Transición | Entrada | Salida | Pérdida |
|---|---|---|---|
| Evidencia SerpAPI → candidatos parseados | 6 queries, 5 con evidencia aplicada | 10 candidatos parseados | 1 query con evidencia real perdió su candidato 100% (envelope bug) |
| Candidatos extraídos → admitidos (shape gate) | 10 | 7 | 30% — todos por ser "solo área" (discutible, ver §11) |
| Composite admitidos → materializados sin rechazo | 7 | 1 | **86%** |
| Component hints → resueltos | 40 | 26 | 35% (mitad de eso es infra, no calidad) |
| Entidades resueltas → identidad correcta | 16 únicas | 8 | **50%** |

**¿Dónde se pierde el 80-100%?** No en un solo punto. Se pierde en cascada: ~10% en extracción (parseo), ~14% en el gate de shape (discutible), y luego **86% de lo que sobrevive se pierde en entity resolution / geo validation combinadas** — ese es el cuello de botella dominante, y dentro de ese 86%, la causa NO es mayormente "no había match" (NO_OSM_MATCH real: 7/40 hints, 17.5%) sino **falsos positivos que rechazan la composite completa cuando OTRO hint del mismo candidato sí falla limpio**, más 7/40 hints (17.5%) perdidos por una falla de infraestructura Overpass verificada en vivo.

---

## 5. SOURCE QUALITY

| Fuente | Resultados crudos | Evidencia composite útil | Falsos positivos de concepto | Calidad de naming | Evidencia de secuencia/orden | Resolvibilidad geo | Tasa final de persistencia |
|---|---|---|---|---|---|---|---|
| **SerpAPI (web) → Groq extractor** | 5/6 queries con evidencia (`groundingStatus=applied`), 1/6 `failed` sin evidencia | **La única fuente capaz de composites.** 8 candidatos multi-componente reales generados, todos con evidencia trazable a un walk/ruta real descrito en el texto (no until inferencia de "aparecen en el mismo párrafo") | 0 casos de fusión de POIs no relacionados detectados en la muestra — el extractor respetó su propia regla | Medio-bueno pero con fallas reales: `"Gorriti 4886"` (fragmento de dirección, prohibido explícitamente por su propio prompt), `"Caminito and Magallanes"` (nombre compuesto inventado) | `orderedByEvidence` correctamente `false` en todos los casos observados — el extractor NO infló evidencia de secuencia que no tenía | Depende 100% del resolver (ver §8) | 1/8 = 12.5% |
| **Wikivoyage** | 15 observations (SEE/DO secciones) en 6 temas | **CERO.** Estructuralmente no puede producir composites — `StructuredExperienceCandidateSynthesizerService` mapea 1 observation → 1 componentHint SIEMPRE (mecánico, verificado en código) | n/a | Alta para nombres de lugar individuales (`Floralis Genérica`, etc.) | n/a (no aplica) | Buena cuando el nombre es exacto; misma fragilidad de resolver que el resto | 3 Experiences únicas, con 2/3 identidades correctas |
| **Google Places** | **0 resultados en 6/6 temas** | 0 | n/a | n/a | n/a | n/a | 0% — la fuente está apagada por config (`PLACES_PROVIDER=geoapify`, sin Text Search descriptivo) |
| **Overpass/Nominatim (resolución, no discovery)** | — | — | — | — | — | Ver §8 | — |

Respuestas directas:

- **¿Qué fuente realmente sabe que una caminata existe?** Solo SerpAPI/web, vía snippets de Google AI Mode que efectivamente describen rutas reales con nombres de paradas (verificado leyendo el `groundedRawOutput` crudo).
- **¿Qué fuente solo enumera lugares turísticos?** Wikivoyage y Google Places, por diseño — esto es correcto, no un bug.
- **¿Qué fuente aporta secuencia explícita?** Ninguna de las 8 composites observadas trajo evidencia real de orden (`orderedByEvidence: false` en todas) — el sistema nunca tuvo que inventar orden porque correctamente nunca lo afirmó.
- **¿Alguna fuente prueba que lugares mencionados juntos son la misma Experience?** Sí, cuando SerpAPI trae un snippet que describe explícitamente un "tour"/"walk" nombrado con sus paradas (el caso exitoso, La Boca). El sistema NO until fusiona candidatos sueltos — verificado: no hay evidencia de "3 lugares mencionados en el mismo párrafo → candidato inventado" en esta muestra.

---

## 6. EXTRACTOR QUALITY

Muestra completa (8 candidatos multi-componente, incluyendo el perdido):

| Candidato | Título respaldado | Componentes aparecen juntos en evidencia | Orden en evidencia | required=true respaldado | expectedKind respaldado | Clasificación |
|---|---|---|---|---|---|---|
| San Telmo Colonial Walking Tour (**perdido en parseo**) | Sí | Sí (San Telmo Market + Lezama Park nombrados en `ev-10`) | No reclamado | Sí | Sí | **faithful** |
| San Telmo & La Boca Culinary Walk | Sí | Sí | No reclamado | Sí | Sí | faithful |
| Recoleta to MALBA Culture & Architecture Trail | Sí | Sí | No reclamado | Sí | Sí | faithful |
| La Boca Historical & Street Art Walk | Sí | Sí | No reclamado | Sí | Discutible — "Caminito and Magallanes" mezcla plaza+calle en un solo hint | **partially inferred** |
| Palermo Soho Urban Art Walk | Sí | Sí | No reclamado | Sí | Sí, salvo `"Gorriti 4886"` — es una dirección, no una entidad, viola su propio prompt | **partially inferred** |
| Recoleta & Palermo Chico Museum Walk | Sí | Sí | No reclamado | Sí | Sí | faithful |
| Buenos Aires Private Museum Hopping and Architecture Tour | Sí | Sí | No reclamado | Sí | Sí | faithful |
| Palmer Walking Loop | Sí | Sí (5 paradas reales nombradas explícitamente) | No reclamado | Sí | Sí | **faithful — el mejor candidato de toda la corrida** |

**Cero casos de "invented/composite hallucination"** en esta muestra de 8. El extractor, cuando corre, es fiel a la evidencia. Su defecto real no es inventar — es (a) un bug de contrato de salida (el envelope) y (b) dos casos de naming subóptimo (dirección como venue, nombre compuesto). **No hay que culpar al resolver por candidatos malos aquí — pero tampoco hay que asumir que el resolver es el único responsable de la falla; el extractor tiene un defecto real y grave que es anterior al resolver.**

---

## 7. GEO DOMAIN MODEL REVIEW

`PLACE / AREA / ROUTE` **son domain types**, correctamente separados del provider type (`osmType: node|way|relation`, `class`, `type` de Nominatim) — la interfaz `ResolvedGeoEntity` los mantiene distintos y `experience-resolution.interface.ts` los documenta bien. El problema NO es que se confundan los conceptos; es que **una política pensada para una pregunta se reusa para otra**:

- `isAreaScaleEligible` (en `nominatim-match.util.ts`) fue diseñada explícitamente ("cutover M3.5") para UNA pregunta: *"¿es este resultado de Nominatim una escala administrativa/de asentamiento usable como scope de destino o de anchor?"* — exige `class==='place'` o (`class==='boundary'` && `type==='administrative'`), rank 13-25, y `osmType !== 'node'`.
- Esa MISMA función se usa dentro de `resolveViaNominatim` para decidir si un **componentHint de una composite** (una plaza, un parque) puede resolver como AREA. Una plaza (`leisure=common`/`place=square`, a veces `class=leisure`) o un parque urbano (`class=leisure`, `type=park`) **casi nunca pasa esa banda de rank** — no porque no sean áreas reales del dominio, sino porque la pregunta que la función responde es otra.

Casos concretos, con evidencia real de esta corrida:

- **"Plaza Dorrego" / "Lezama Park" (sesión anterior, M9)** y en esta corrida **"Palermo Chico"** (`role=area`) → `NO_OSM_MATCH` en los tres casos. No es casualidad: el pool local para hints `AREA` es literalmente `[boundary]` (el boundary del destino ENTERO, un solo candidato), nunca un query real de "áreas dentro del boundary" — y el fallback global las descarta por `isAreaScaleEligible`.
- **¿Por qué Plaza Dorrego/Lezama Park eran esperados como AREA?** Porque el extractor los clasificó así (`role: area, expectedKind: AREA`) — decisión razonable a nivel de concepto (una plaza/parque es, en términos de dominio, más un área que un punto). El problema no es que el extractor se equivoque en pedir AREA; es que el resolver no tiene NINGÚN mecanismo capaz de resolver un AREA de esa escala.
- **¿Es correcto en nuestro domain que una plaza sea AREA?** Defendible — pero entonces el resolver necesita una vía distinta de `isAreaScaleEligible` para validarlas (geometría real Polygon/way, sin exigir rank administrativo), o el dominio necesita degradar esas hints a `waypoint/PLACE` cuando no hay evidencia de que se camine "dentro" de ellas. Ninguna de las dos cosas existe hoy.
- Pérdida semántica confirmada entre provider result y decisión canónica: **el resolver descarta la representación provider (node/way/relation, class/type) inmediatamente después de decidir aceptar/rechazar — no queda registrado en ningún lado por qué una AREA fue rechazada por escala vs por no-match**, lo cual hace este mismo diagnóstico más difícil de automatizar a futuro.

---

## 8. ENTITY RESOLUTION REVIEW

Muestra: 16 pares únicos (hint → resolución) observados en la corrida real (dedupe de repeticiones idénticas entre temas), más 7 hints con `NO_OSM_MATCH` limpio y 7 con `OSM_QUERY_EMPTY` (infra).

| Hint | Resuelto a | Provider | Veredicto |
|---|---|---|---|
| Centro Científico Tecnológicos | **"CE"** (osm:node:1144740077) | local (substring) | **FALSO POSITIVO** |
| Galería Güemes | Mirador Galería Güemes | local (substring) | correcto (mismo complejo real) |
| Iglesia San Ignacio de Loyola | **"Iglesia"** (osm:node:2744146114, coords ~8km de la real) | local (substring) | **FALSO POSITIVO** |
| San Telmo (area) | San Telmo (osm:relation:2223069) | Nominatim global, `isAreaScaleEligible` OK | correcto |
| Mercado de San Telmo | **"MO"** (osm:node:5415007421, ~8.5km de distancia) | local (substring) | **FALSO POSITIVO** (reproducido independientemente, sesión anterior y esta) |
| Floralis Generica | Floralis Genérica | local | correcto |
| MALBA Museum | **"B"** (osm:node:6033692285) | local (substring) | **FALSO POSITIVO** |
| Caminito and Magallanes | Caminito | local | correcto (parcial, por suerte — nombre compuesto) |
| Riachuelo | Paseo del Riachuelo | local | correcto |
| La Bombonera | **"B"** (MISMO nodo que MALBA, ~10km de distancia real entre ambos lugares) | local (substring) | **FALSO POSITIVO** |
| Pasaje Santa Rosa | Pasaje Santa Rosa | Nominatim global | correcto |
| Pasaje Russel | Pasaje Russel | Nominatim global | correcto |
| Plaza Serrano | Plaza Serrano | local | correcto |
| Museo Nacional de Bellas Artes | **"B"** (mismo nodo, 3ra vez) | local (substring) | **FALSO POSITIVO** |
| MALBA | **"B"** (mismo nodo, 4ta vez) | local (substring) | **FALSO POSITIVO** |
| Iglesia San Ignacio de Loyola (2do intento, otro request) | Iglesia San Ignacio de Loyola, **Córdoba** (600km) | Nominatim global | falso positivo, **pero atrapado por geo validation** |

```
correct resolution rate:   8/16 = 50%
false positive rate:       8/16 = 50%
  de los cuales atrapados por geo validation downstream:  1/8 (12.5%)
  de los cuales NO atrapados (persistidos o determinantes de rechazo):  7/8 (87.5%)
ambiguity rate:            0% — el contrato NO TIENE estado "ambiguous" para GeoEntity (solo resolved|unresolved)
```

Un solo nodo OSM mal-tageado (`"B"`, osm:node:6033692285) fue aceptado como identidad correcta para **cuatro lugares reales, distintos y no relacionados** (MALBA Museum, La Bombonera, Museo Nacional de Bellas Artes, MALBA de nuevo). Esto no es un caso límite — es la firma de un defecto sistémico.

Respuestas directas:

- **¿Exact-name matching?** No. `matchOsmCandidateByName` usa contención de substring **bidireccional sin guardas** (`haystack.includes(needle) || needle.includes(haystack)`) — así es como `"mo"` (nombre real del nodo, probablemente una abreviatura o tag mal cargado en OSM) matchea `"mercado de san telmo"` (contiene "mo" dentro de "telMO"), y `"b"` matchea literalmente cualquier hint que contenga la letra B.
- **¿Fuzzy matching?** Sí, pero solo en el path global de Nominatim (`bestNominatimMatch`), que SÍ tiene guardas razonables (token >=4 caracteres, overlap >=50%, al menos un token >=5 caracteres). **La ruta local (Overpass) no tiene ninguna de esas guardas.** Esa asimetría es el defecto concreto.
- **¿Provider ranking / distance?** Solo se usa `distanceMeters`/`rankNominatimCandidates` para DESEMPATAR entre varios candidatos igualmente válidos por nombre — nunca como GATE de rechazo. Un único candidato geográficamente absurdo pero "único" pasa igual.
- **¿Boundary containment / anchor scope?** El único containment real ocurre DESPUÉS, en `CompositeGeographicValidationService`, contra el boundary del DESTINO COMPLETO (Buenos Aires), nunca contra el anchor específico (San Telmo). Por eso "MO" (dentro de CABA, fuera de San Telmo) nunca es geográficamente rechazado.
- **¿Semantic category?** No se usa en ningún punto — un nodo sin ningún tag de `tourism`/`historic`/`shop` puede matchear igual que uno etiquetado correctamente.

Lo que se pierde entre el resultado del provider y la decisión canónica: **toda noción de "¿esto realmente se parece, en identidad, al hint pedido?"** El pipeline solo pregunta "¿hay algo cuyo string se solapa?" y "¿está adentro del polígono correcto?" — nunca "¿es plausible que sean la misma entidad real?".

---

## 9. GEOGRAPHIC VALIDATION REVIEW

Geo validation **funciona correctamente para el trabajo que tiene asignado**: rechazó limpiamente la iglesia homónima de Córdoba (600km, `destination_mismatch`) y aceptó correctamente La Boca (`canonical_geometry`, GEO_VERIFIED). **No encontré ningún caso donde geo validation rechazara algo que debía aceptar, ni aceptara algo groseramente fuera del destino.**

El problema no es su ubicación en el pipeline — es su **alcance conceptual**: geo validation solo sabe geometría (containment, coherencia, distancia), nunca identidad/nombre. Por diseño no puede — ni debería tener que — detectar que `"MO"` no es `"Mercado de San Telmo"`, porque geométricamente `"MO"` está perfectamente adentro de Buenos Aires. Esa es literalmente la pregunta que **debe** resolverse antes, en entity resolution, no reubicando geo validation.

- **¿Por qué "MO" sobrevive entity resolution?** Porque `matchOsmCandidateByName` no tiene concepto de confianza/plausibilidad de nombre (§8).
- **¿Debería el containment ocurrir DENTRO de resolution?** Sí, parcialmente — un gate de "¿el candidato aceptado está razonablemente cerca del anchor/scope relevante del propio candidato, no solo del destino?" pertenece al momento de decidir si un match es válido, no después. Pero el chequeo de coherencia geométrica agregada (todo el composite junto) sigue teniendo sentido como paso separado, posterior.
- **¿Se valida después de exigir que TODOS los componentes resuelvan?** Sí — y eso significa que un candidato con 1 componente correcto + 1 componente con identidad falsa pero "resuelto" puede pasar el gate de "todos resolvieron" y llegar a geo validation con una mentira adentro, mientras que un candidato con 1 componente correcto + 1 genuinamente sin match es rechazado limpio. **Eso invierte el orden de gravedad que pide el spec: un falso positivo termina siendo tratado como "mejor" que un unresolved honesto**, exactamente lo que la Parte 4 original de esta tarea (antes del giro adversarial) ya había identificado como principio a proteger.
- **¿Destino + MUST area se usan como scope real?** No para component resolution (§2, §7) — sí para el anchor resuelto en sí mismo (`San Telmo` resolvió correctamente vía el path global).

**¿Deben seguir siendo dos fases separadas resolution/validation?** Sí — pero resolution necesita una fase de confianza de identidad ANTES de considerarse "resolved", y ahí es donde falta contrato, no en fusionar las dos fases.

---

## 10. COMPOSITE CONTRACT REVIEW

- **¿Todos los components deben resolver?** Hoy, sí — cualquier hint `required=true` sin resolver tumba el candidato entero (`UNRESOLVED_REQUIRED_COMPONENT`). En 5/9 rechazos de materialización esa fue la causa.
- **¿Quién decide `required`?** El extractor LLM, en el momento de extracción — nunca revisado ni ajustado después. En la muestra observada, el extractor marcó `required: true` en absolutamente todos los hints, de las 8 composites, sin una sola excepción — sugiere que el campo no está siendo usado con criterio real por el modelo, es casi un valor por defecto.
- **¿Puede existir una Experience válida con 3/4 components?** No, estructuralmente — el contrato es todo-o-nada sobre los `required`. El caso real observado (`San Telmo & La Boca Culinary Walk`, 1 de 3 componentes sin resolver) fue descartado por completo, aun teniendo 2 componentes plausibles (uno de ellos, eso sí, con identidad falsa — "MO" — así que en este caso puntual el rechazo total resultó ser, por casualidad, el resultado correcto).
- **¿Qué invalida una ruta?** Hoy: cualquier componente `required` sin resolver, o falla de coherencia/destino geométrica. No hay concepto de "ruta parcialmente válida".
- **¿Deberíamos separar core stops vs optional stops?** Es defendible — pero **no es la causa raíz de la señal "0 composites"** en esta corrida: de los 7 candidatos composite que llegaron a materialización, ninguno falló SOLO por exigencia excesiva de `required` sobre un componente marginal; fallaron porque componentes que el extractor SÍ marcó como centrales (Faculty of Law, National Museum of Fine Arts, Plaza Italia, etc.) no resolvieron. Relajar `required` no habría salvado ninguno de estos 6 rechazos reales.
- **¿Route order es evidence-backed o model-generated?** Evidence-backed correctamente — `orderedByEvidence` fue `false` en el 100% de la muestra, y el sistema respeta eso (persiste `order: null`). **No until encontré ningún caso de orden inventado.**

**No propongo relajar validación como respuesta por default** (tal como pide la consigna) — el hallazgo real es que el contrato de "área no cuenta para MULTI_COMPONENT_EXPERIENCE" descartó 3 candidatos completamente compuestos de áreas (`Palermo Viejo, Soho & Hollywood Food Walk`, `Palermo Street Food & Milanesa Walk`) sin darles NINGUNA oportunidad de resolución — eso sí merece una decisión de producto explícita: ¿un walk que conecta 3 barrios nombrados, sin ningún punto concreto, es una Experience válida o es demasiado vago para ofrecerse? Hoy la respuesta es implícita (no) y nunca se decidió a propósito.

---

## 11. MATERIALIZATION REVIEW

| Rejection reason | Count | Root cause real | Owner correcto |
|---|---|---|---|
| `UNRESOLVED_REQUIRED_COMPONENT` | 5 | Upstream — entity resolution no encontró match (a veces real gap de fuente, a veces el nombre del hint es defectuoso: dirección/compuesto) | Resolver + Extractor |
| `OSM_QUERY_EMPTY` | 3 | Upstream — infraestructura Overpass local degradada bajo carga sostenida (ver §7, §13) | Infraestructura |
| `destination_mismatch` (geo validation) | 1 | Correcto — geo validation hizo su trabajo bien | Nadie, es un éxito |

**No until encontré ningún defecto dentro de `persistVerifiedExperience`/`ExperienceCatalogService` en sí.** El dedupe SAME/NEW/AMBIGUOUS, las transacciones con `pg_advisory_xact_lock`, y el rechazo cuando `components.length===0` se comportaron exactamente como está documentado en cada uno de los 22 candidatos observados. **Materialization no es demasiado estricta ni está mal — está correctamente rechazando basura upstream**, con una excepción: no tiene forma de saber que una identidad "resuelta" es en realidad falsa (§8), así que persiste basura con la misma confianza que persiste algo correcto. Eso no es un defecto de materialization — es la propagación del defecto de §8.

---

## 12. ON-DEMAND VS CATALOG-FIRST

Evidencia real de esta corrida, no especulación:

- **Latencia observada:** un solo tema (6 acquisition calls: wikivoyage+places+web, seguido de resolution+geo-validation+classification para hasta 6 candidatos) tomó entre **~20 segundos y ~8 minutos** dependiendo de rate limiting de Groq (backoffs observados de hasta 21.25s, múltiples reintentos por llamada).
- **Rate limiting real:** Groq devolvió 429 en al menos 2 de los 6 temas durante esta corrida — con `AI_CACHE_MODE=read` y sin caché previa, cada llamada de extracción y cada llamada de clasificación es una llamada real nueva.
- **Fragilidad de infraestructura real:** Overpass local pasó de responder correctamente (temas 1-4) a devolver **cero POIs para toda la Ciudad de Buenos Aires** (tema 5 en adelante, y confirmado independientemente con una query de control después de terminar los 6 temas) — sin ningún error HTTP, solo un resultado vacío. Un self-hosted Overpass de un solo contenedor no sostiene queries repetidas de área grande dentro de una sesión.
- **Costo real:** cada composite walk potencial cuesta, en el peor caso, 1 SerpAPI search + 1-3 llamadas Groq (con reintentos) + N llamadas Nominatim/Overpass (una por hint) + 1 llamada Groq de clasificación — todo **síncrono dentro del request de generación de un Tour**, si esto se ejecutara dentro de `ExperienceGenerationService` en lugar de en mi script standalone.

| | Architecture A (on-demand, actual) | Architecture B (catalog-first) |
|---|---|---|
| Reliability | Depende de 3 proveedores externos respondiendo bien EN EL MOMENTO del request del usuario — observado fallando (SerpAPI `groundingStatus=failed` 1/6, Overpass vacío 2/6) | Los mismos fallos ocurren, pero offline, sin bloquear a un usuario esperando su Tour |
| Latency | Minutos por tema, en el critical path del usuario (inaceptable para UX de generación de Tour) | Cero latency adicional para el usuario — el catálogo ya existe |
| Cost | Se paga el mismo LLM+SerpAPI call potencialmente MÚLTIPLES veces si distintos usuarios piden temas similares para el mismo destino | Se paga una vez por destino×tema, se reusa indefinidamente |
| Dedupe | El dedupe SAME/NEW/AMBIGUOUS ya existe y funciona iguial en ambas arquitecturas — no es un diferenciador | igual |
| Debuggability | Difícil — cada corrida es un evento efímero mezclado con la lógica de un Tour real | Fácil — un job de enrichment aislado, re-ejecutable, con logs propios (como el characterization script de esta review) |
| Consistency | Dos usuarios pidiendo "Buenos Aires, historia, walk" el mismo día pueden recibir resultados distintos según qué falló esa vez | Consistente — mismo catálogo para todos |
| User experience | El usuario espera minutos, o el sistema degrada silenciosamente a POIs sueltos sin explicar por qué (exactamente el síntoma reportado: `TOUR_UNDERFILLED walk`) | El usuario nunca ve la latencia de acquisition |

**No elijo B porque el usuario la sugirió — la elijo porque la evidencia de latencia/rate-limit/fragilidad de infraestructura observada EN VIVO en esta misma corrida hace que "on-demand durante generación de Tour" sea, en la práctica, indistinguible de "a veces no hay composites" desde la perspectiva del usuario final**, incluso en los casos donde el pipeline sería capaz de producir un resultado correcto si tuviera más tiempo/reintentos. Esto no invalida el pipeline (el catálogo también necesita exactamente este mismo pipeline para poblarse) — invalida hacerlo síncrono dentro de un request de usuario.

---

## 13. FAILURE TREE

```
ZERO (O CASI CERO) COMPOSITE EXPERIENCES PERSISTIDAS Y CONFIABLES
        │
        ├── acquisition too thin?
        │     PROBABLY PROBLEM — Google Places aporta 0 en 6/6 temas (config, no bug),
        │     reduciendo breadth ~33%. No es la causa dominante del "0 composites".
        │
        ├── sources unsuitable?
        │     NOT SUPPORTED como afirmación general — SerpAPI trajo evidencia real de
        │     walks en 5/6 queries. Wikivoyage/Places son "unsuitable para composites"
        │     POR DISEÑO, correctamente.
        │
        ├── extractor hallucination?
        │     NOT SUPPORTED — 0/8 candidatos observados inventan una composite sin
        │     evidencia real. SÍ hay un bug de contrato de salida (envelope) — PROVEN,
        │     grave, pérdida silenciosa de al menos 1/8 candidatos reales.
        │
        ├── bad component semantics?
        │     PROBABLY PROBLEM (menor) — exclusión de hints `role=area` del conteo
        │     MULTI_COMPONENT_EXPERIENCE descartó 3 candidatos sin darles resolución.
        │     Decisión de producto no explícita, no necesariamente incorrecta.
        │
        ├── entity resolution weak?
        │     PROVEN, causa dominante — 50% de las resoluciones únicas observadas son
        │     identidades falsas (osm:node:6033692285 "B" reutilizado 4 veces para 4
        │     lugares distintos). matchOsmCandidateByName no tiene guardas de
        │     especificidad/longitud, a diferencia del path global que sí las tiene.
        │
        ├── geo validation misplaced?
        │     NOT SUPPORTED en cuanto a ubicación — funciona correctamente para lo que
        │     hace (containment/coherencia). PROVEN que le falta una dimensión
        │     (identidad/nombre) que hoy no existe en ningún lado del pipeline.
        │
        ├── admission too strict?
        │     PROBABLY PROBLEM (menor, ver bad component semantics)
        │
        ├── materialization wrong?
        │     NOT SUPPORTED — se comportó correctamente en los 22 candidatos
        │     observados; solo propaga fielmente errores upstream.
        │
        └── architecture itself wrong?
              PARTIALLY — la FORMA del pipeline es capaz de un éxito real de punta a
              punta (demostrado, 1 composite persistida correctamente). El defecto
              arquitectónico real es hacerlo SÍNCRONO dentro de un request de usuario
              contra 3 proveedores externos con fragilidad observada en vivo (§12).
```

---

## 14. TOP 5 ROOT CAUSES (ranked por evidencia/impacto)

1. **Bug de contrato de salida del extractor Groq (envelope shape).** `GroqDiscoveryProvider` corre en modo `json_object` sin schema forzado; cuando el modelo responde un objeto candidato "pelado" en vez de `{"candidates":[...]}`, `extractExperienceCandidates` lo interpreta silenciosamente como `entries=[]` — **cero candidatos, cero errores, cero señal**. Confirmado con evidencia directa: el raw output de la corrida de "history" contenía literalmente el mismo composite que originó todo este ticket (`San Telmo Market` + `Lezama Park`) y se perdió sin dejar rastro. **Impacto: alto — pérdida silenciosa total, indetectable sin inspeccionar el raw output manualmente.**

2. **`matchOsmCandidateByName` sin guardas de especificidad (substring bidireccional puro).** Reproducido de forma independiente 8 veces en una sola corrida, incluyendo un solo nodo mal-tageado (`"B"`) que capturó 4 lugares reales distintos. **Impacto: alto — corrompe identidad de datos ya persistidos, no solo bloquea nuevos.**

3. **`PLACES_PROVIDER=geoapify` apaga por completo el fallback de Google Places** que el propio código documenta como necesario para "landmarks pequeños que OSM no cubre bien" — confirmado: 0 resultados en 12 intentos (2 por tema × 6 temas), con solo un WARN log fácil de ignorar. **Impacto: medio-alto — es la razón por la que "Faculty of Law", "Gorriti 4886", los dos museos nacionales, nunca tuvieron oportunidad de resolver por la vía que el diseño previó para exactamente ese caso.**

4. **Ausencia total de un concepto de "geographic scope específico del candidato/anchor"** en `ExperienceProposalResolverService` — el resolver siempre usa el boundary del destino completo, nunca el anchor (`San Telmo`) que la propia arquitectura ya resolvió antes en `resolvedAnchors`. Esto es lo que permite que un falso positivo por nombre (punto 2) además pase geo validation sin ser detectado. **Impacto: medio — amplifica el punto 2, no lo causa por sí solo.**

5. **Fragilidad real de infraestructura Overpass local bajo carga sostenida.** Observado en vivo: de responder correctamente (temas 1-4) a devolver 0 POIs para toda la ciudad (tema 5+, confirmado independientemente después). **Impacto: medio — 7/40 hints (17.5%) perdidos por esto, incluyendo el mejor candidato de toda la corrida (`Palmer Walking Loop`, 5 paradas reales, evidencia perfecta).**

---

## 15. WHAT IS NOT ACTUALLY BROKEN

- El **flujo de alto nivel** (Destination → Discovery → Resolution → Validation → Materialization → Composition → Planning) — demostrado capaz de un éxito real de punta a punta en esta misma corrida.
- **Provider isolation / anti-hallucination del extractor** — cero coordenadas/IDs inventados en 8 candidatos observados, cero fusiones de POIs no relacionados.
- **`persistVerifiedExperience` / dedupe SAME-NEW-AMBIGUOUS / transacciones** — se comportó correctamente en 22/22 candidatos observados.
- **`CompositeGeographicValidationService`** en su alcance actual (geometría) — correcta en los 2 casos límite reales observados (aceptar La Boca, rechazar la iglesia de Córdoba).
- **El fuzzy matching global de Nominatim (`bestNominatimMatch`)** — tiene guardas razonables (longitud mínima de token, overlap 50%+) que la ruta local no tiene; es evidencia de que el equipo YA SABE cómo hacer esto bien, solo no se aplicó de forma pareja.
- **El respeto a `orderedByEvidence=false`** — el sistema nunca inventó una secuencia que la evidencia no daba.

**Advertencia operativa (no arquitectónica):** esta corrida escribió datos reales en la base de datos de desarrollo compartida (`zigzag` en el Postgres del compose), incluyendo al menos 2 `Experience` con identidad de `GeoEntity` incorrecta (`"CE"`, `"Iglesia"`) y 1 composite nueva correcta (`La Boca Historical & Street Art Walk`). No las borré — decisión del usuario si quiere limpiarlas.

---

## 16. ARCHITECTURE VERDICT: **B**

No A: hay **contratos ausentes**, no solo bugs de una línea — específicamente, no existe ningún concepto de "confianza de identidad" en entity resolution (punto 2/4), y no existe ningún concepto de validación de contrato de salida del LLM extractor (punto 1). Ambos requieren diseñar algo que hoy no existe, no corregir algo que existe mal.

No C: el pipeline **produjo un resultado real, correcto, completo, de punta a punta** en esta misma corrida (`La Boca Historical & Street Art Walk`) sin ningún hardcodeo ni ayuda manual. La descomposición en fases (discovery → resolution → validation → materialization) es la correcta y no until encontré evidencia de que deba aplanarse o reordenarse.

Boundaries que sí necesitan rediseño de contrato (no parche):
- Entity resolution: necesita un concepto explícito de match confidence (nombre + geografía combinados, fail-closed cuando no hay evidencia suficiente) — esto es lo que la tarea original (antes del giro adversarial de esta sesión) ya había empezado a diseñar correctamente.
- Discovery extraction: necesita validación/reparación de contrato de salida cuando el proveedor no fuerza JSON schema (Groq en particular).
- Timing model: acquisition de composites no debería ser síncrona dentro de un request de generación de Tour, dado el rate-limiting e infra-fragilidad reales observados.

Boundaries que están bien y NO necesitan redesign: composite contract (salvo la decisión de producto pendiente sobre area-only walks), materialization, geographic validation (en su alcance actual), provider isolation.

---

## 17. PROPUESTA ARCHITECTURE V2 (boundaries afectados solamente)

```
┌─────────────────────────────────────────────────────────────┐
│  ENTITY RESOLUTION (contrato nuevo)                          │
│                                                                │
│  matchCandidate(hint, pool, scope) → {                        │
│    status: 'resolved' | 'unresolved' | 'ambiguous',           │
│    confidence: number,        ← NUEVO                         │
│    identityEvidence: {         ← NUEVO                        │
│      nameOverlapScore, tokenSpecificity, geoDistance,          │
│      withinRelevantScope: boolean  ← usa el anchor específico,│
│                                        no solo el destino      │
│    }                                                            │
│  }                                                              │
│                                                                │
│  Regla fail-closed: confidence bajo el umbral → 'unresolved',  │
│  NUNCA 'resolved' con baja confianza. 'ambiguous' cuando dos    │
│  candidatos igualmente plausibles compiten sin señal decisiva. │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  DISCOVERY EXTRACTION (contrato nuevo)                        │
│                                                                │
│  parseExtractorOutput(raw) →                                  │
│    intenta {candidates:[...]} primero,                        │
│    fallback: si `raw` parece UN candidato individual           │
│      (tiene name+componentHints), envolverlo → [raw]           │
│      Y loguear explícitamente "envelope repair applied"        │
│      (nunca silencioso)                                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  TIMING MODEL                                                  │
│                                                                │
│  Tour generation NUNCA espera una acquisition run completa.    │
│  Un job de enrichment separado (catalog-first, ver §12)        │
│  puebla el catálogo de composites por destino×tema de forma    │
│  asíncrona/batch. Tour generation solo hace gap-acquisition     │
│  acotada (1 intento, timeout corto) cuando el catálogo         │
│  realmente no tiene nada — nunca la vía principal.             │
└─────────────────────────────────────────────────────────────┘
```

Respuestas explícitas:

- **¿Qué debe saber el LLM?** Qué evidencia describe qué candidato, y con qué confianza semántica (temas/intents). Nunca coordenadas, nunca IDs de provider, nunca "esto seguro es la misma entidad que tal OSM node" — eso sigue sin ser su trabajo, y hoy ya lo respeta.
- **¿Qué NO debe decidir el LLM?** Identidad geográfica final (correcto hoy), ni el contrato de salida (`required`, hoy decidido 100% por el LLM sin ninguna revisión — debería al menos loguearse como señal de confianza, no como hecho binario).
- **¿Qué debe resolver OSM?** Geometría real y relaciones espaciales (containment, distancia, corredores) — lo hace bien.
- **¿Qué NO debe resolver OSM?** Identidad de nombre por sí solo, sin una señal de especificidad — hoy lo hace mal (matchOsmCandidateByName).
- **¿Qué debe resolver Google Places?** Landmarks pequeños/comerciales que OSM no cubre — diseño correcto, ejecución muerta por config.
- **¿Qué aporta Wikivoyage?** POIs individuales curados editorialmente — correcto, nunca composites.
- **¿Qué aporta web search?** La única señal real de "esto es una ruta/walk nombrada" — irremplazable con el resto del stack actual.
- **¿Qué evidencia necesitamos antes de crear una composite?** ≥2 componentes reales, nombrados explícitamente como parte de una misma secuencia/tour/walk en el texto fuente — el extractor ya exige esto correctamente.
- **¿Cuándo una candidate se convierte en Experience?** Cuando TODOS los componentes required resuelven con confidence sobre el umbral (nuevo) — no simplemente "resolved" en el sentido binario actual.

---

## 18. MIGRATION PLAN (secuencia mínima segura)

1. **Fix del envelope parsing del extractor** (Root Cause #1) — aislado, sin dependencias, alto impacto, bajo riesgo. Tests: candidato-objeto-pelado → debe extraerse igual, con logging explícito de "repair applied".
2. **Guardas de especificidad en `matchOsmCandidateByName`** (Root Cause #2) — mismo patrón que `bestNominatimMatch` ya usa (token mínimo, overlap mínimo). Tests: nombre corto/genérico dentro de un hint largo → debe NO matchear.
3. **Confirmar/corregir `PLACES_PROVIDER`** (Root Cause #3) — decisión operativa, no de código (o agregar un log de nivel ERROR/warn más visible cuando el provider activo no soporta text search, para que no vuelva a pasar desapercibido).
4. **Enchufar `resolvedAnchors` como scope narrowing opcional en resolution** (Root Cause #4) — requiere tocar la orquestación (fuera del alcance de "solo entity resolution"), evaluar como paquete separado.
5. **Retry/circuit-breaker sobre Overpass** (Root Cause #5) — infraestructura, no dominio.
6. Recién después de 1-5: decidir sobre el timing model (§12/§17) — es el cambio de mayor alcance, se beneficia de tener datos limpios (post 1-2) para medir el impacto real.

---

## 19. ACCEPTANCE CRITERIA (capability real, no fixture)

No fijo `N=20` arbitrariamente — la evidencia de esta corrida (8 candidatos reales generados en 6 temas de una sola ciudad) sugiere que un umbral razonable, alcanzable con las fuentes actuales, es:

```
Buenos Aires, 10 temas representativos (history, food, culture, art,
architecture, nature, tango, nightlife, literature, wine):

  >= 15 candidatos multi-componente evidence-backed generados
  >= 8  geográficamente admitidos (resueltos con confidence sobre umbral)
  >= 6  persistidos como Experience nueva

  segunda corrida (mismo destino, sin resetear DB):
  >= 90% de los mismos candidatos → dedupe SAME (no reacquisition)
  0 explosión de duplicados
```

Esto distingue "funciona por accidente" (1 composite en 6 temas, dependiente de qué tan bien se portó Groq/Overpass ese día) de "es una capability" (tasa de éxito estable, reproducible, con reuse demostrado en warm run).

---

## 20. RECOMMENDED NEXT STEP

**Un solo milestone coherente:** corregir el envelope parsing del extractor (Root Cause #1) + agregar guardas de especificidad a `matchOsmCandidateByName` (Root Cause #2), con tests que prueben los invariantes genéricos (no fixtures de San Telmo), y volver a correr esta misma caracterización de 6 temas contra Buenos Aires para medir el delta real en la tasa de éxito de composites (hoy 12.5%). Recién con ese número nuevo tiene sentido decidir si el timing model (catalog-first) es la siguiente prioridad o si el resto de los root causes (3, 4, 5) ya lo compensan lo suficiente.

No recomiendo atacar los 5 root causes en paralelo ni redisenar el timing model todavía — los primeros dos son la mayoría de la pérdida observada y son aislados/de bajo riesgo; medir después de esos dos evita gastar el rediseño más caro (Architecture B) sobre un número que todavía no sabemos si sigue siendo malo una vez corregido lo barato.

---

```
CODE CHANGED:
NO

COMMIT:
NONE

PUSH:
NOT PERFORMED
```
