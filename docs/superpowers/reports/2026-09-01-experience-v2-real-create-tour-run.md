# Corrida real de createTour — Experience Domain V2

Fecha: 2026-09-01  
Branch: `feat/experience-domain-v2`  
Destino: Gualeguaychú, Entre Ríos  
Backend: worktree `ui-redesign`, PostgreSQL local, Outbox + InMemoryQueue

## Resultado

- `tourId`: `78101c2b-caf0-435b-b01d-8fe106103790`
- Estado final: `failed`
- Duración observada: aproximadamente 62 s desde POST hasta fallo terminal
- Motivo: `MAX_CONTINUOUS_WALKING_EXCEEDED` en el día 1, al ingresar al candidato `36595480-6634-4aaa-b055-d7cfbb8750f5`
- El endpoint de creación respondió rápidamente con `generationStatus=pending`; la generación ocurrió de forma async.
- La Bitácora quedó persistida y fue recuperable después del fallo.

## Etapas observadas

La traza persistida incluyó la nueva etapa `preference_interpretation` junto con intención, resolución de destino, cobertura, búsqueda de catálogo, discovery, Places, pool de candidatos, embeddings, planificación y validaciones finales.

La interpretación libre se incorporó antes del ranking. Para esta corrida se normalizaron preferencias equivalentes a:

- temas preferidos: arquitectura histórica y caminata costanera;
- exclusión dura: lugares religiosos;
- preferencia semántica positiva: comida vegana y arquitectura histórica/costanera.

Las exclusiones se aplican determinísticamente sobre los candidatos antes del ranking; el LLM no decide identidad geográfica ni factibilidad.

## Adquisición y discovery

- Catálogo local: 42 actividades recuperadas.
- Google Places: refill ejecutado; el catálogo se mantuvo en 42 actividades utilizables.
- Grounded search: Tavily, modelo registrado `tavily-search-basic`.
- Query efectiva observada: destino + `naturaleza`, `cultura`, `comida`, preferencias veganas, arquitectura histórica y caminata costanera.
- Discovery todavía conserva una incompatibilidad pendiente con V2: genera una búsqueda estructural con `targetKind=NEIGHBORHOOD_WALK` y valida propuestas contra hints mínimos. En esta corrida devolvió 0 propuestas válidas porque las propuestas no tenían suficientes hints adicionales.
- Gemini aparece como extractor de discovery y tuvo un timeout/reintento; esto quedó separado del fallo final de planificación.

## Async / Outbox

Los logs confirmaron:

1. creación transaccional de `Tour` + `TourGenerationRequested`;
2. claim del publisher;
3. dispatch al consumidor;
4. updates de progreso por outbox;
5. persistencia de `TourFailed`.

Durante la corrida se detectó que un consumidor que marca el tour como `failed` y luego lanza la excepción provocaba redelivery y repetía providers/planner. El processor ahora trata `generationStatus=failed` como estado terminal para entregas duplicadas; un retry explícito deberá iniciar una nueva generación por API.

## Diagnóstico

El flujo completo ya no se detiene por `REQUESTED_FORMAT_NOT_ACQUIRED`: cuando falta una preferencia estructural, continúa con candidatos factibles. La corrida actual se detuvo correctamente en la validación determinística de movilidad. El próximo bloque debe migrar discovery y adquisición de formatos a Experiencias sin `targetKind`, y luego mejorar la selección/ruteo para que el planner encuentre una secuencia que respete el límite de caminata.

No se registraron secretos en la Bitácora; los payloads de trace pasan por redaction centralizada.

## Segunda corrida después de quitar el gate estructural

- `tourId`: `67cc4293-4751-4440-b085-193780d526b9`
- Estado final: `completed`
- Duración observada: aproximadamente 110 s (incluyó espera de catálogo/Overpass)
- Actividades persistidas: 9, distribuidas en 2 días.
- La etapa `discovery` hizo una búsqueda genérica guiada por temas; el query de Tavily ya no llevó `targetKind` y devolvió 9 evidencias/4 propuestas.
- Las 4 propuestas fueron rechazadas por validación geográfica; la generación continuó con el catálogo local verificado y materializó snapshots `TourExperience`.
- La planificación determinística completó el tour con límites peatonales amplios. Overpass tuvo respuestas 429/timeout degradadas, sin invalidar las Experiencias ya verificadas.

Esta corrida confirma que la ausencia de un formato estructural no impide construir un tour real. Queda pendiente que la traza de discovery exponga `searchTrace` con la misma riqueza que el resumen de grounding y que el provider/model de la etapa de preferencias se verifique en una corrida posterior al rebuild (el código ya usa metadata pública y segura de `LangChainService`).
