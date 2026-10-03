# Experience Domain V2 — Checkpoint 0

Fecha: 2026-09-02  
Branch: `feat/experience-domain-v2`  
HEAD: `2c9d7d827d0eff010ad03189649e469a0db794ef`  
Remote tracking: `fork/feat/experience-domain-v2` at `8e6c29250a60b4bb5f02ef97463e5c16395ef8d6`  
Base histórica: `feat/geographic-validation-outbox-media-hardening`

## Divergencia

El plan fue redactado sobre `e7e739961b231a789b5c4fecb0721749f5545dda`.
El HEAD actual contiene además la limpieza V2, el informe E2E de Ushuaia y el
merge de los commits remotos del plan (`33a075c`, `8e6c292`). No cambia los
invariantes; sí agrega documentación y elimina demos/fixtures Activity.

## Base de datos

- PostgreSQL local: `zigzag-postgres`, healthy.
- `NODE_ENV=development`; `DATABASE_URL` apunta a `localhost:5432/zigzag`.
- Conteos: `experience=14`, `geo_entity=17`, `tour=382`,
  `tour_experience=94`.
- `prisma migrate status`: up to date, 11 migrations.
- No se ejecutó reset ni operación destructiva. La base local es identificable
  y segura para pruebas aisladas; cualquier reset futuro debe usar una base
  temporal separada.

## Infraestructura e inventario

`.codegraph/` existe y fue consultado. Están presentes los caminos V2 de
catalog, acquisition, discovery planner, proposal resolver, coverage,
Experience generation, deterministic planner, outbox, queue, media y trace.
No hay entrypoint administrativo V2 ni flujo day-trip V2 cerrado.

El runtime no contiene lecturas/escrituras de modelos Activity; los restos
detectados están en acceptance tests heredados y algunos comentarios/documentos.

## Baseline

| Comando | Exit code | Resultado |
| --- | ---: | --- |
| `yarn --cwd be tsc -p tsconfig.build.json --noEmit --incremental false` | 0 | PASS |
| `yarn --cwd be test --runInBand --silent` | 0 | 80 suites / 517 tests PASS |
| `yarn --cwd be test --config ./test/jest-acceptance.json --runInBand` | 1 | 19 suites FAIL, 1 PASS |
| `yarn --cwd be run check` | 2 | falla compilación de acceptance heredada |
| `yarn --cwd be run build` | 1 | EPERM al reemplazar `be/dist`, no error TypeScript de runtime |
| `yarn --cwd be prisma migrate status` | 0 | schema up to date |

Los fallos de acceptance incluyen `Activity`, `ActivityKind`, `ExperienceFormat`,
`activities`, `activityId`, `selectedActivities`, `entityHints` y utilidades
eliminadas. No se excluyeron tests para obtener el baseline.

## Gate

**FAIL — Checkpoint 0** hasta reparar el harness y contratos de acceptance en
Checkpoint 1. La divergencia es conocida y no cambia el dominio; se continúa
con la implementación según el plan, empezando por Checkpoint 1.
