#!/usr/bin/env bash
# Dumps knowledge-table row counts for a dedicated spike DB as JSON.
# Usage: ./catalog-counts.sh <db_name> > out.json
set -euo pipefail
DB="$1"

read_count() {
  docker exec zigzag-postgres psql -U postgres -d "$DB" -t -A -c "SELECT count(*) FROM $1;"
}

cat <<EOF
{
  "database": "$DB",
  "capturedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "experience": $(read_count experience),
  "experienceComponent": $(read_count experience_component),
  "experienceEvidence": $(read_count experience_evidence),
  "experienceTrait": $(read_count experience_trait),
  "geoEntity": $(read_count geo_entity),
  "geoEntityIdentity": $(read_count geo_entity_identity),
  "traitDefinition": $(read_count trait_definition)
}
EOF
