# Synthetic Tours + OpenSpec — CURRENT PROGRESS

<!-- agent-track: id=synthetic-tours-openspec; status=ACTIVE; branch=feat/synthetic-tours-openspec; integration=main; base=16f41e89eb238431b339dfccc22473f791ed4908; plan=docs/superpowers/plans/2026-10-09-openspec-documentation-governance-cutover.md -->

Updated: 2026-10-10  
Branch: `feat/synthetic-tours-openspec`  
Repository: `entity-builders-labs/zig-zag`

> Bootstrap authority only. This current-format progress file exists to satisfy
> Zig-Zag collaboration governance while OpenSpec is characterized and adopted.
> It must not become a second permanent source of product/change truth once the
> OpenSpec cutover is accepted.

## Current execution verdict

**ACTIVE — OpenSpec bootstrap + synthetic Experience generation prototype.**

Preference-First has been merged to `main` and is accepted as foundation.
This track starts from accepted `main` and preserves the current
GeoEntity/Experience/catalog/planner domain.

The first real OpenSpec change will be:

`synthetic-experience-generation`

The intended architectural direction is to compose reusable Experiences from
canonical GeoEntities rather than infer canonical Experiences from arbitrary
web prose.

## Current checkpoint

**OS1 / OS2 bootstrap.**

- Characterize the actual OpenSpec CLI/workflow and generated repository
  artifacts.
- Initialize OpenSpec on this isolated track.
- Use synthetic Experience generation as the first bounded real OpenSpec change.
- Do not redesign the existing Experience/GeoEntity domain unless evidence
  proves a required domain gap.
- Do not implement synthetic-tour production behavior before the OpenSpec
  proposal/design/spec/tasks artifacts exist and the affected current domain
  contracts have been mapped.

## Next authorized action

1. Complete and inspect the repository-local output of `openspec init`.
2. Create the OpenSpec change `synthetic-experience-generation`.
3. Map current reusable domain contracts and implementation boundaries into the
   change proposal/design.
4. Define a bounded first spike for synthetic composition over canonical
   GeoEntities before production implementation.

## Open findings / blockers

- Decide which existing `zig-zag-track-*` skills remain unchanged, which need
  OpenSpec awareness, and which become redundant after cutover.
- Decide how active OpenSpec change identity and `tasks.md` replace the
  execution-state responsibility currently carried by progress/plan without
  creating permanent dual authority.
- Synthetic narrative/media generation is intentionally downstream of proving
  coherent composition and validation.
