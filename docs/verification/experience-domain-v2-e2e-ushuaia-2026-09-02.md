# E2E de generación V2 — Ushuaia

Fecha: 2026-09-02  
Branch: `feat/experience-domain-v2`  
Tour: `0c9f0230-0243-4805-a155-6126af8da116`  
Resultado: `failed` después de 40 s  
Experiencias persistidas: `0`

## Recorrido real

1. **Interpretación de preferencias — PASS (860 ms).** Groq interpretó el
   texto libre y produjo temas `landscapes`, `local history`, `architecture`,
   `gastronomy`, traits de accesibilidad/autenticidad y una consulta semántica.
2. **Intención y movilidad — INFO.** El contrato V2 llegó completo: 2 días,
   pareja, ritmo moderado, walking/driving y límites de 7 km diarios / 2,5 km
   continuos.
3. **Resolución del destino — PASS.** Nominatim resolvió Ushuaia a boundary
   administrativo real (`scale=area`, `boundaryName=Ushuaia`).
4. **Cobertura inicial — FAIL.** El catálogo local devolvió 0 candidatos; se
   requerían 8. Los temas quedaron como warnings, pero la ausencia total de
   candidatos fue blocking.
5. **Grounded discovery — WARN.** Tavily ejecutó dos búsquedas con contexto de
   Ushuaia y preferencias, pero el extractor produjo 0 propuestas utilizables.
6. **Refill de Places — FAIL.** La llamada live a Google Places falló con HTTP
   400: `Max number of place results to return must be between 1 and 20`.
   El motor envió `maxResultCount=250`, que es el límite interno del pool y no
   un valor válido para la API de Google.
7. **Cobertura posterior — WARN/FAIL.** Después del fallo del proveedor siguió
   con 0 candidatos y registró correctamente `provider_unavailable` y
   `insufficient_usable_candidates`.
8. **Ranking semántico — PASS formal, sin candidatos.** Se invocó con Ollama,
   pero no tuvo nada que rankear.
9. **Planificación/materialización — no ejecutadas.** El motor terminó antes:
   no creó `TourExperience` ni pudo construir días.

## Outbox

Se publicaron `TourGenerationRequested=1`, `TourProgressUpdated=4` y
`TourFailed=1`. La redelivery posterior de `TourGenerationRequested` fue un
no-op porque el tour ya estaba marcado como fallido.

## Diagnóstico

La resolución de destino, la interpretación, el trazado de decisiones y el
fail-fast async funcionan. La corrida no llega al planner porque hay un bug de
integración: `CATALOG_RETRIEVAL_POOL_LIMIT=250` se pasa directamente a
Google Places Nearby, cuyo máximo permitido es 20. Gualeguaychú no lo reveló
porque su refill fue cache hit.

Además, el extractor grounded devolvió cero propuestas para Ushuaia; eso es un
resultado observable, pero no fue la causa primaria del error terminal: aun con
propuestas vacías, el refill de Places debería haber intentado una solicitud
válida o dividirla en páginas/lotes.
