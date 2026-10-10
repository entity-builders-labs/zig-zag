#!/usr/bin/env bash
# Knowledge-table counts + integrity checks for one dedicated spike DB (JSON).
set -euo pipefail
DB="$1"
q() { docker exec zigzag-postgres psql -U postgres -d "$DB" -t -A -c "$1"; }
cat <<JSON
{
  "database": "$DB",
  "capturedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "geoEntity": $(q 'SELECT count(*) FROM geo_entity'),
  "geoEntityByKind": $(q "SELECT coalesce(json_object_agg(kind, n), '{}') FROM (SELECT kind, count(*) n FROM geo_entity GROUP BY kind) x"),
  "geoEntityIdentity": $(q 'SELECT count(*) FROM geo_entity_identity'),
  "verifiedHintMemoryEntries": $(q 'SELECT coalesce(sum(cardinality("verifiedHintNameKeys")),0) FROM geo_entity'),
  "duplicateIdentityRows": $(q 'SELECT count(*) FROM (SELECT provider, "externalId" FROM geo_entity_identity GROUP BY 1,2 HAVING count(*) > 1) x'),
  "duplicateVerifiedHintKeysWithinKind": $(q "SELECT coalesce(json_agg(json_build_object('kind', kind, 'key', key, 'entities', n)), '[]') FROM (SELECT g.kind, k AS key, count(DISTINCT g.id) n FROM geo_entity g, unnest(g.\"verifiedHintNameKeys\") k GROUP BY 1,2 HAVING count(DISTINCT g.id) > 1) x"),
  "experience": $(q 'SELECT count(*) FROM experience'),
  "experienceByStatus": $(q "SELECT coalesce(json_object_agg(status, n), '{}') FROM (SELECT status, count(*) n FROM experience GROUP BY status) x"),
  "experienceComponent": $(q 'SELECT count(*) FROM experience_component'),
  "duplicateExperienceNames": $(q 'SELECT count(*) FROM (SELECT lower("canonicalName") FROM experience GROUP BY 1 HAVING count(*) > 1) x'),
  "experiences": $(q "SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.name), '[]') FROM (SELECT e.id, e.\"canonicalName\" AS name, e.status, count(c.id) AS components, json_agg(json_build_object('geoEntityId', g.id, 'geoEntity', g.name, 'kind', g.kind, 'order', c.\"order\", 'role', c.role) ORDER BY c.\"order\" NULLS LAST, g.name) FILTER (WHERE c.id IS NOT NULL) AS componentSet FROM experience e LEFT JOIN experience_component c ON c.\"experienceId\" = e.id LEFT JOIN geo_entity g ON g.id = c.\"geoEntityId\" GROUP BY e.id) x"),
  "geoEntities": $(q "SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.name), '[]') FROM (SELECT g.id, g.name, g.kind, g.geometry->>'type' AS geometryType, g.\"verifiedHintNames\" AS hints, (SELECT json_agg(i.provider || ':' || i.\"externalId\" ORDER BY i.provider, i.\"externalId\") FROM geo_entity_identity i WHERE i.\"geoEntityId\" = g.id) AS identities FROM geo_entity g) x")
}
JSON
