# Local PostgreSQL 15 with both pgvector and PostGIS.
#
# Base: pgvector/pgvector:pg15 (Debian 12 "bookworm", PostgreSQL 15 + pgvector
# already built in, with the PGDG apt repo already configured). We only add
# the PostGIS packages on top so the same local database serves both:
#   - pgvector  -> Experience embeddings / semanticSimilarity ranking
#   - PostGIS   -> radius/spatial catalog geography retrieval
# See docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md
# for why both extensions live in one database rather than a separate store.
FROM pgvector/pgvector:pg15

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       postgresql-15-postgis-3 \
       postgresql-15-postgis-3-scripts \
  && rm -rf /var/lib/apt/lists/*
