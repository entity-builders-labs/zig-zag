# A6 Review Correction — PostGIS Boundary Required

Status: **A6 IMPLEMENTED, REVIEW FIX REQUIRED**
Branch: `feat/preference-first-selection`
Written: 2026-09-11

Original A6 implementation:
`e4e89886ea6205b1202b5f221551ae78f397e6c9`

Original A6 progress commit:
`02a49e8faf2a44e70401b097b571626319dc7a26`

Canonical fix plan:
`docs/superpowers/plans/2026-09-11-a6-1-postgis-geospatial-catalog-boundary.md`

Canonical design addendum:
`docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md`

---

## Review result

A6's semantic behavior is accepted:
- canonical facet matcher;
- A5 strongness;
- weak = match but not strong;
- A4 satisfaction;
- deterministic bucket ordering;
- no embeddings in coverage;
- no live wiring.

A6 is **not yet accepted as complete** because its geography boundary uses
`FACET_RETRIEVAL_LIMIT = 2000` over `ExperienceCatalogService.findVerifiedWithin`.
The underlying catalog method also performs a bounded global scan before radius
filtering. These are correctness-visible caps that can hide a relevant in-scope
Experience before semantic matching.

The old progress statement `Status: COMPLETE` / `Deviations from plan: None`
must therefore be read as historical agent output, not the final review verdict.

---

## Required next task

**A6.1 — PostGIS Geospatial Catalog Boundary Review Fix**

A6.1 must:
- keep PostgreSQL as the database;
- keep pgvector;
- add PostGIS to the local PostgreSQL image/database;
- add a forward migration enabling PostGIS and a spatial GiST index;
- replace the bounded JS/Prisma geography scan for facet retrieval with a
  PostGIS query over Experience components → GeoEntity coordinates;
- remove `FACET_RETRIEVAL_LIMIT = 2000` as a correctness mechanism;
- prove correctness beyond both old 2,000-result and bounded-global-scan
  thresholds;
- preserve A6 matching/strong/weak semantics;
- not start A7.

---

## Current execution gate

```text
A1 ✅
A2 ✅
A3 ✅
A4 ✅
A5 ✅
A6 ⚠️ implementation exists, review-blocked
A6.1 ⏭️ NEXT
A7 ⛔ blocked until A6.1 review approval
```

No meaningful new local-app UI behavior is expected from A6.1. It is catalog
infrastructure/retrieval correctness; verification is through DB/integration tests.
