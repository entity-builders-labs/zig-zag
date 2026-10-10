# A6.1 — PostGIS Geospatial Catalog Boundary Review Fix

Status: **required before A7**
Branch: `feat/preference-first-selection`
Written: 2026-09-11

Canonical references:
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md`

This is the required review-fix immediately after A6. It supersedes A6's
`FACET_RETRIEVAL_LIMIT = 2000` workaround but preserves the rest of A6.

Do **not** start A7 until this task is reviewed and approved.

---

## Context

A6 implementation commit:

`e4e89886ea6205b1202b5f221551ae78f397e6c9`

A6 correctly introduced:
- `FacetRetrievalService`;
- canonical facet matching;
- strong/weak bucketing;
- `facetSatisfied(strongMatches.length)`;
- real-Postgres tests;
- no embeddings in coverage.

The review found one blocking correctness issue: `FACET_RETRIEVAL_LIMIT = 2000`
does not eliminate arbitrary truncation before semantic matching. The current
`ExperienceCatalogService.findVerifiedWithin` also performs a bounded global
`take` before radius filtering. Increasing the constant only moves the failure
threshold.

A6.1 fixes that boundary using PostGIS.

---

## Task 1 — Local PostgreSQL supports pgvector + PostGIS

Current local DB image is `pgvector/pgvector:pg15`.

Create an owned PostgreSQL Dockerfile that preserves pgvector and installs the
PostGIS packages compatible with PostgreSQL 15 and the current developer
architecture. Prefer extending the existing pgvector image after verifying its
base distribution/package names.

Update `docker-compose.yml` so the `postgres` service builds that image instead
of using `image: pgvector/pgvector:pg15` directly.

Do not introduce a random third-party combined image.

Acceptance:

```sql
SELECT extname
FROM pg_extension
WHERE extname IN ('vector', 'postgis');
```

returns both extensions after migrations/bootstrap.

The DB is disposable local development data. No data preservation/backfill is
required. A clean-volume rebuild is part of verification.

---

## Task 2 — Forward migration enables PostGIS + spatial index

Do not edit old migrations.

Add a new Prisma migration that:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Keep `vector` enabled as today.

Update `schema.prisma` datasource extension metadata to include PostGIS if the
current Prisma version supports that declaration without breaking generation.

For A6.1, prefer **not** adding a second persisted location column. Keep existing
`GeoEntity.latitude` / `longitude` as point-coordinate source and create a
partial GiST expression index using PostGIS geography, conceptually:

```sql
CREATE INDEX IF NOT EXISTS geo_entity_location_gist_idx
ON geo_entity
USING GIST (
  (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)
)
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL;
```

Use the exact SQL form that PostgreSQL accepts and that the matching query can
reuse.

AREA/ROUTE polygon/line migration is out of scope.

---

## Task 3 — Replace bounded catalog geography scan

Modify `ExperienceCatalogService` with a canonical method specifically suitable
for preference-first geographic retrieval. Naming may be
`findVerifiedWithinForMatching`, `findAllVerifiedWithin`, or another clear name.

Do not implement another JS/Prisma global scan with a larger `take`.

The spatial selection must happen in PostgreSQL/PostGIS by joining:

```text
experience
  ↓ experience_component
geo_entity
```

Semantics:
- Experience status = VERIFIED;
- at least one resolved component GeoEntity is within `radiusMeters`;
- distance for ordering = minimum component distance to query center;
- deterministic order = distance ASC, Experience id ASC;
- no correctness-visible hard result limit;
- bare/no-component Experience is not geographically eligible through this
  boundary;
- hydrate the resulting IDs through the canonical catalog hydration path so
  components + traits keep their existing shape.

Parameterized raw SQL through Prisma is allowed/expected for PostGIS operators.
Never concatenate user coordinates/radius into SQL strings.

A representative query is specified in the PostGIS design addendum. Preserve its
semantics even if the exact SQL differs.

---

## Task 4 — Update `FacetRetrievalService`

Remove:

```ts
const FACET_RETRIEVAL_LIMIT = 2000;
```

and stop calling the old bounded `findVerifiedWithin(..., 2000)` path for A6
facet retrieval.

Use the new PostGIS-backed catalog boundary.

Preserve exactly:
- `requestedFacetToPreferenceFacet` adapter;
- `isStrongFacetMatch` for strong;
- canonical matcher for weak;
- unrelated candidates excluded;
- `facetSatisfied(strong.length)`;
- strongest-first deterministic bucket sorting;
- optional A5 `StrongMatchPolicy` passthrough;
- no embedding/vector use in coverage.

Do not wire the live tour-generation path yet.

---

## Task 5 — Tests

### Docker/migration smoke

From a clean local volume, prove migrations succeed and both extensions exist.

A disposable DB reset is allowed and expected for this task.

### Catalog integration tests — real Postgres/PostGIS

Add tests that would fail with the old bounded implementation:

1. **Old 2000-window regression**
   - seed >2000 in-scope VERIFIED component-grounded Experiences;
   - put the only history match beyond the old closest-2000 selection boundary;
   - history target must still be retrieved.

2. **Old global-scan regression**
   - place enough unrelated VERIFIED rows before the target that the old bounded
     global scan would have omitted it;
   - unrelated rows may be geographically outside the requested radius;
   - use efficient SQL/bulk seeding to keep test runtime reasonable;
   - target must still be retrieved.

3. **Radius truth**
   - outside-radius component => Experience not returned;
   - inside-radius component => returned.

4. **Composite geography**
   - Experience with multiple components is in scope if any component is in
     radius;
   - nearest component controls deterministic distance ordering.

5. **Stable ordering**
   - same distance => id tie-break is deterministic.

6. **No embedding authority**
   - non-history candidate carrying any diagnostic/mock semantic similarity
     equivalent to `0.99` still does not enter history strong or weak matches.

7. **Bare row**
   - no-component Experience never becomes strong; do not require the new
     component-grounded spatial boundary to return it as weak.

Keep/rework the existing A6 tests rather than duplicating semantics unnecessarily.

### Verification commands

At minimum:

```bash
# clean local DB image/volume verification
docker compose down -v
docker compose --profile dev build postgres
docker compose --profile dev up -d postgres

cd be
yarn prisma migrate deploy
# or the repository's canonical dev migration command if different

yarn test src/modules/tours/services/facet-retrieval.service.spec.ts
yarn test:integration --testPathPattern=facet-retrieval
yarn typecheck
npx eslint \
  src/modules/tours/services/facet-retrieval.service.ts \
  src/modules/tours/services/facet-retrieval.service.spec.ts \
  src/modules/tours/services/experience-catalog.service.ts \
  test/integration/tour-generation/facet-retrieval.integration-spec.ts
yarn test src/modules/tours
yarn test:integration
```

If the repository uses another exact Prisma migration command, inspect package
scripts and use the canonical command instead of blindly copying the example.

---

## Task 6 — Progress + commits

Do not rewrite A6's historical implementation SHA.

Record A6.1 as a review fix with:
- original A6 implementation SHA `e4e89886ea6205b1202b5f221551ae78f397e6c9`;
- A6.1 implementation commit SHA;
- tests/results;
- Docker/PostGIS verification;
- migration name;
- explicit statement that `FACET_RETRIEVAL_LIMIT=2000` is gone;
- explicit statement that no A7 work was started.

Recommended implementation commit message:

```text
fix(tours): use PostGIS for complete facet geography retrieval
```

Then update progress in a separate docs commit:

```text
docs(progress): record A6.1 PostGIS retrieval hardening
```

Push both and STOP.

---

## Non-goals

Do NOT:
- implement A7 iconicity;
- use embeddings to retrieve/cover facets;
- migrate AREA polygons or ROUTE LineStrings yet;
- remove pgvector;
- split vector/spatial data into separate databases;
- add Pinecone/OpenSearch/etc.;
- redesign Experience/GeoEntity identity;
- wire live tour generation;
- optimize every spatial query in the application;
- preserve disposable local DB rows.

---

## Definition of Done

A6.1 is done when:

```text
local PostgreSQL = pgvector + PostGIS
                    ↓
PostGIS selects all VERIFIED Experiences with grounded components in radius
                    ↓
NO arbitrary pre-semantic cap
                    ↓
FacetRetrievalService
  canonical matcher
  + A5 strongness
  + A4 satisfaction
                    ↓
strong / weak / satisfied
```

and regression tests prove the result remains correct beyond both old bounded
failure thresholds.

Only after review approval may execution continue with **A7 — Iconicity util**.
