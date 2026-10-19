# Task 40.1 — Single-place Experience composition
Branch: `feat/synthetic-tours-openspec`; delivery: feature branch; runner: Jest / PostgreSQL.

## Specs

### S1 — OpenSpec task 40.1

> 40.1 Compose single-place Experiences (one required VISIT component of an admitted PLACE GeoEntity that is its own visit unit) with a stable composition signature, sub-features derived from PART_OF rather than copied into Experience content, persisted visit-duration knowledge projected with provenance, per-date opening-hours knowledge of the GeoEntity with provenance (UNKNOWN never defaulted to open), and project them to the planning input contract (group 25) reading GeoEntity knowledge (C14) and removing the normalizer's hidden `metadata.openingHours` fallback; no Experience kind, no PLACE_VISIT entity and no second place catalog; verify integration tests: zero L2 required, signatures stable across recomposition and across duration-provenance changes, Experiences updated in place, failed enrichment cannot revoke an admission or archive the Experience

Acceptance: production DB integration exercises composition, persistence and C14 planning projection. Missing duration remains missing; unknown hours remain UNKNOWN. Do not implement 40.2.

## Tasks

- T1 — S1 — inline — complete — implementation in `4d620934` and `7a8714b0`; final evidence is recorded in the OpenSpec task and track progress.

## Log

### L1 — User authorization

Use only task 40.1; database credentials from the configured repository `.env` are authorized only for `zigzag_39_test`, with `.env` unchanged. Do not mark complete until required integration coverage and gates pass. Do not start 40.2.

### L2 — Evidence

- WIP checkpoint: `b8c06796`.
- C14 composition/projection work unit: `4d620934`.
- PostgreSQL target and repository disposable guard verified before integration reset; current database confirmed as `zigzag_39_test`.
- Final DB integration passed on `zigzag_39_test`; targeted tests passed 113/113; typecheck, changed-file ESLint, strict OpenSpec validation, and diff check passed. The independent verifier's metadata fallback finding was fixed and rechecked.
- Clean-worktree preflight passed: WRITE AUTHORIZED / INTEGRATION READY. No Prisma schema migration was needed for 40.1.
