# Generation Trace / Bitácora v5 cutover

Status: **ACCEPTED / COMPLETED — current trace design authority**.

## Migration inventory

The live writer is `ExperienceGenerationService.generateTourExperiences()`.
It records request/interpretation, destination and anchor resolution, catalog
lookup and coverage, acquisition/source planning, web retrieval/extraction,
entity and geographic validation, materialization, candidate composition,
ranking, daily planning, completeness, and TourExperience persistence. The
trace is stored in `Tour.metadata.generationTrace`, returned unchanged by the
Tour read API, and consumed in `fe/app/tours/[id].tsx` by
`GenerationBitacora`.

The starting v4 contract had a central stage union, stage-specific audit
objects, and a large trace builder; the frontend duplicated the same shape.

## Native v5 contract

`GenerationTraceV5` is a small envelope: `version: 5`, non-secret runtime
provenance, canonical request, terminal result, and ordered `TraceStepV5`s.
Each step has an opaque `id`, optional `parentId`, monotonic `sequence`, open
ended `name`, optional description/component/timing, generic JSON
input/output/facts, decision, rules, subjects and references. `TraceReference`
uses `kind`, stable `id`, optional label and URL; transient candidates use the
existing trace key while persisted objects use canonical IDs.

`JsonValue` is only a persisted audit serialization envelope. Typed domain
results stay in their owning services. A producer projects its typed result to
bounded audit data and passes it to the recorder; domain code must never read a
trace to make a decision.

## Recorder and safety boundary

`GenerationTraceRecorder` owns IDs, sequence allocation, parent validation,
sanitation and final envelope creation. It does not decide eligibility,
classification, geography, ranking, dedupe, or planning. Its centralized
ceiling redacts credential keys and credential-like strings/signed URLs, limits
strings to 8,000 characters, arrays/objects to 100 entries, depth to eight,
and each step to 48,000 serialized characters. Truncation is explicit.

## UI

Bitácora renders all v5 steps generically. It sorts by sequence, indents by
parent relationship, displays decision/reason/reason codes, rules,
subjects/references, timing, and collapsible input/output/facts JSON. Unknown
names need no component or switch case.

## Cutover/migration

The native persistence writer emits v5 only. All pipeline producers record
native v5 steps directly at their decision boundaries. Per the repository's
early-stage deletion rule, the temporary legacy projection bridge, v4
interfaces, builder, and v4-only tests have been deleted. Historical v1-v4
development traces are intentionally unsupported by the v5 UI.

## Acceptance examples

A classifier decision owner must project a temporary provider failure as a
normal `classification.semantic` step: `WARN/DEGRADED`, reason code
`PROVIDER_UNAVAILABLE`, and bounded facts `provider`, `model`, `httpStatus` and
provider status. The UI requires no classification-specific component to show
this. A future `researcher.fetch_web_source` step is equally valid without a
central schema edit.
