-- CreateExtension
--
-- PostGIS alongside pgvector in the same PostgreSQL database (Task A6.1 --
-- docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md).
-- pgvector keeps owning Experience embeddings/semanticSimilarity ranking;
-- PostGIS owns the radius/spatial catalog geography boundary.
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Note: `prisma migrate dev` also proposed `DROP INDEX
-- "experience_embedding_hnsw_idx"` here. That index is real, current and
-- load-bearing (see 20260902224500_add_experience_embedding_hnsw) -- it is
-- a raw-SQL-only index with no schema.prisma model attribute (same
-- pre-existing pattern as the old Activity HNSW index), so Prisma's
-- schema-diff engine sees it as drift relative to schema.prisma and wants
-- to drop it. That drop is unrelated to PostGIS and out of A6.1's scope --
-- removed here rather than applied.

-- CreateIndex
--
-- Partial GiST expression index over GeoEntity point coordinates, so
-- PostGIS's ST_DWithin/ST_Distance radius queries (Task A6.1's canonical
-- catalog geography boundary) can use an index instead of a sequential
-- scan. Restricted to rows with non-null coordinates -- matches the A5
-- validity contract (finite latitude in [-90,90], finite longitude in
-- [-180,180]) is enforced by the querying code, not by this index itself;
-- the partial WHERE clause here only excludes the NULL case PostGIS cannot
-- project at all.
CREATE INDEX IF NOT EXISTS "geo_entity_location_gist_idx"
ON "geo_entity"
USING GIST (
  (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)
)
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL;
