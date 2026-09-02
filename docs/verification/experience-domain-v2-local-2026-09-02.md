# Verificación local — Experience Domain V2

Fecha: 2026-09-02  
Branch: `feat/experience-domain-v2`  
Destino: Gualeguaychú, Entre Ríos

## Resultado

- Tour: `6b63f36b-c2ea-40d4-9505-019a863e1b77`
- Estado: `completed`
- Experiencias materializadas: `9`
- Bitácora persistida: `11` etapas
- Resumen de ejecución: `completed`
- Tests backend: `80` suites, `517` tests, todos verdes
- Build web: exportado correctamente

## Decisiones trazadas

1. Las preferencias se interpretaron como `nature`, `culture`, `food` y
   `architecture`, con preferencia libre sobre Costanera, carnaval y gastronomía.
2. El destino resolvió al límite real de Gualeguaychú.
3. El catálogo tenía 14 Experiences verificadas; la cobertura temática quedó
   registrada como advertencia, no como bloqueo.
4. Se ejecutó Places Text Search como adquisición, pero fue cache hit con cero
   nuevas Experiences.
5. El pool final conservó 14 Experiences canónicas y no aplicó gates de formato
   legacy.
6. El ranking semántico no encontró vectores compatibles y aplicó fallback
   explícito por calidad/proximidad.
7. El planner determinístico seleccionó 9 Experiences para 2 días y dejó 5 sin
   seleccionar.
8. Se persistieron snapshots `TourExperience` y se publicó `TourCompleted`.

## Async/outbox

Para el tour se observaron 8 eventos, todos `PUBLISHED`: 1
`TourGenerationRequested`, 6 `TourProgressUpdated` y 1 `TourCompleted`.
La corrida omitió media por `skipImageGeneration=true`, por lo que no se
esperan eventos de enriquecimiento multimedia en este caso.

## Migración

La migración `20260902120000_remove_activity_domain_v2` se aplicó localmente
sin reset y conserva los datos V2. En entornos nuevos debe ejecutarse después
de la cadena histórica; elimina de forma idempotente las tablas y enums
Activity que todavía creen las migraciones anteriores.
