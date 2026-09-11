# PostGIS Geospatial Catalog Boundary — Canonical Addendum

Status: **canonical design addendum for Preference-First A6/A6.1**
Written: 2026-09-11
Branch of record: `feat/preference-first-selection`

Related:
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- `docs/superpowers/plans/2026-09-11-a6-1-postgis-geospatial-catalog-boundary.md`
- `docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`

This addendum resolves the A6 review finding that `FACET_RETRIEVAL_LIMIT = 2000`
does not satisfy the canonical requirement “no arbitrary truncation before
semantic matching”. It supersedes A6's bounded-scan workaround while preserving
A6's strong/weak semantics.

---

## 1. Decision

Zig-Zag will use **PostGIS inside the existing PostgreSQL database** as the
canonical radius-query boundary for geographically scoped Experience catalog
retrieval.

PostgreSQL remains the single database. Local development must support both:

```text
PostgreSQL 15
├── pgvector  → Experience embeddings / semanticSimilarity
└── PostGIS   → radius / spatial catalog retrieval
```

PostGIS and pgvector have separate responsibilities:

```text
PostGIS
  answers: “which grounded Experiences are actually in geographic scope?”

canonical facet matcher + A5
  answers: “which of those actually match this requested facet, and are they strong?”

pgvector / embeddings
  answers later: “among already valid/matching candidates, which are semantically
  closer to this user's request?”
```

Vector similarity MUST NOT be pushed into the PostGIS/coverage boundary.

---

## 2. Why A6's current limit is insufficient

The current A6 implementation calls:

```ts
findVerifiedWithin(..., 2000)
```

and the existing catalog method internally performs a bounded global scan before
radius filtering. This can lose an in-scope relevant Experience when:
- its row falls after the global scan cap; or
- more than the chosen final limit are inside the radius and the relevant row is
  outside the distance slice before facet matching.

A larger constant changes the failure threshold but does not remove the
correctness bug.

Canonical rule:

> Geographic scope must be resolved by the database before semantic matching,
> without a correctness-visible hard cap on the in-scope result set.

A batching/page size used internally for hydration is allowed. A semantic/result
limit that can hide an in-scope match before facet evaluation is not.

---

## 3. Geography authority

Experience Domain V2 already says physical geography belongs to `GeoEntity` and
that selectable Experiences contain resolved `ExperienceComponent`s.

For this addendum:
- `GeoEntity.latitude` / `GeoEntity.longitude` remain the point-coordinate source
  used by existing code;
- PostGIS is used to query those coordinates efficiently;
- `Experience.latitude` / `Experience.longitude` are not the authoritative
  spatial-membership predicate for preference-first retrieval;
- an Experience is geographically in scope when at least one resolved component
  GeoEntity lies within the requested radius;
- for deterministic ordering, its catalog distance is the minimum component
  distance to the query center, then stable Experience id.

A bare Experience with no resolved component cannot become geographically
eligible/strong merely because top-level Experience lat/lng exists.

AREA/ROUTE polygon/line migration is explicitly out of A6.1 scope. It can be a
later spatial-domain enhancement; A6.1 only needs point/radius retrieval.

---

## 4. Local PostgreSQL / Docker

Current local Docker uses `pgvector/pgvector:pg15`. Replace the direct image with
an owned Docker build that preserves pgvector and installs PostGIS for PostgreSQL
15.

Do not switch to an unrelated third-party “everything bundled” image merely for
convenience. Extend the known pgvector image (or another explicitly reviewed
PostgreSQL 15 base that demonstrably supports both extensions on the developer's
architecture).

The rebuilt local database must support:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;
```

The local data is disposable. No historical-data backfill or zero-downtime
migration is required for this step. It is acceptable and expected to validate
from a clean volume (`docker compose down -v` + rebuild) during A6.1.

Do not rewrite old migrations. Add a new forward migration.

---

## 5. Prisma / SQL boundary

Prisma remains the ORM for normal persistence/hydration. PostGIS spatial
selection may use parameterized `$queryRaw` where Prisma cannot express the
required spatial operator/index cleanly.

Update the datasource extension declaration to include PostGIS alongside vector
when compatible with the current Prisma version, and add a migration that:

1. enables `postgis`;
2. creates the required spatial index over `geo_entity` point coordinates.

A separate persisted `location` column is **not required for A6.1**. To avoid a
new dual-write source of truth, the preferred narrow implementation is a PostGIS
expression over the existing longitude/latitude columns, for example:

```sql
ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
```

with a matching partial GiST expression index for rows with non-null finite-ish
coordinates.

The query and index expressions must match closely enough for PostgreSQL/PostGIS
to use the spatial index. Verify with an `EXPLAIN`-level test/manual check if
necessary, but do not turn query-plan text into a brittle unit assertion.

If implementation evidence shows that a stored `geography(Point,4326)` column is
materially safer with the repository's PostgreSQL/Prisma versions, it is allowed
only if there is one deterministic write path keeping it in sync. Do not add an
unspecified second geography source of truth.

---

## 6. Canonical catalog query

Add/replace the catalog geography boundary so it selects Experience IDs from
`experience` → `experience_component` → `geo_entity` using PostGIS.

Conceptually:

```sql
SELECT
  e.id,
  MIN(
    ST_Distance(
      ST_SetSRID(ST_MakePoint(g.longitude, g.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography
    )
  ) AS distance_meters
FROM experience e
JOIN experience_component ec ON ec.experience_id = e.id
JOIN geo_entity g ON g.id = ec.geo_entity_id
WHERE e.status = 'VERIFIED'
  AND g.latitude IS NOT NULL
  AND g.longitude IS NOT NULL
  AND ST_DWithin(
    ST_SetSRID(ST_MakePoint(g.longitude, g.latitude), 4326)::geography,
    ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
    :radiusMeters
  )
GROUP BY e.id
ORDER BY distance_meters ASC, e.id ASC;
```

Exact SQL may differ for safe parameterization/casting, but semantics may not.

Then hydrate those IDs through the existing canonical catalog hydration path
(`findVerifiedByIds` or a single equivalent method) so component + trait shape
stays identical to the rest of the ranking pipeline.

There must be no `LIMIT 2000`, no `take:8000`, and no other correctness-visible
hard cap before `candidateMatchesPreferenceFacet` is evaluated.

---

## 7. A6 semantics preserved

A6.1 changes the geographic retrieval boundary only.

Keep:
- `candidateMatchesPreferenceFacet` as the one facet truth primitive;
- A5 `isStrongFacetMatch` as strongness authority;
- weak = canonical facet match but not strong;
- `facetSatisfied(strongMatches.length)`;
- deterministic strongest-first bucket ordering;
- no embeddings in coverage/strong/weak;
- no live orchestration wiring yet.

Do not start A7 as part of A6.1.

---

## 8. Required tests

Use real PostgreSQL with PostGIS enabled.

Must prove:
1. both `vector` and `postgis` extensions are available in the test/dev database;
2. a relevant Experience is returned even when it is beyond the old 2,000-row
   destination-window failure threshold;
3. a relevant in-scope Experience is returned even when its global Experience
   row/id would have fallen beyond the old bounded global scan; use efficient
   bulk seeding if needed so the test is not needlessly slow;
4. out-of-radius components do not make an Experience in-scope;
5. for a multi-component Experience, any component inside the radius makes it
   geographically eligible and ordering uses the nearest component distance;
6. deterministic distance then id ordering;
7. a non-matching Experience with hypothetical semantic similarity 0.99 still
   cannot enter history strong/weak coverage;
8. a bare/no-component Experience never becomes strong and need not be returned
   by the component-grounded spatial boundary;
9. existing A6 unit semantics remain green;
10. full tour module tests and full integration tests remain green.

The scale regression test must fail if the implementation is reverted to the
old `limit=2000` / bounded-global-scan behavior.

---

## 9. Production parity

This task does not deploy AWS infrastructure, but the design assumes production
PostgreSQL supports the same two extensions. RDS PostgreSQL is the intended
production-compatible shape.

Do not introduce a local-only spatial abstraction that would require a different
production database product.

A later deployment task must ensure the production RDS engine/version supports
both `postgis` and `vector` before applying migrations.

---

## 10. Acceptance

A6.1 is complete only when:
- local PostgreSQL runs pgvector + PostGIS together;
- clean-volume migrations succeed from scratch;
- the catalog radius query is database-spatial, component-grounded and indexed;
- no arbitrary pre-semantic result cap remains;
- A6's strong/weak/satisfied semantics remain unchanged;
- the old `FACET_RETRIEVAL_LIMIT = 2000` workaround is removed;
- the required regression tests are green.

Until then A6 is **implemented but review-blocked**, and A7 must not begin.
