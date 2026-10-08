-- Post-run DB evidence for partial composite persistence (read-only).
--   docker exec -i zigzag-postgres psql -U postgres -d <db> < partial-composite-db-evidence.sql

\echo '== Experiences with more than one source member'
SELECT e.id,
       e."canonicalName",
       e.status,
       e."createdAt",
       count(c.id) AS source_members,
       count(c.id) FILTER (WHERE c."resolutionState" = 'RESOLVED') AS resolved_members,
       count(DISTINCT c."geoEntityId") AS distinct_geo_entities,
       count(c.id) FILTER (WHERE c."resolutionState" = 'UNRESOLVED') AS unresolved_members,
       CASE WHEN count(c.id) FILTER (WHERE c."resolutionState" = 'UNRESOLVED') = 0
            THEN 'COMPLETE' ELSE 'PARTIAL' END AS derived_completeness
FROM experience e
JOIN experience_component c ON c."experienceId" = e.id
GROUP BY e.id
HAVING count(c.id) > 1
ORDER BY e."createdAt";

\echo '== Source-member table of every multi-member Experience'
SELECT e."canonicalName",
       c."sourcePosition",
       c."sourceName",
       c."resolutionState",
       c."resolutionReason",
       c."geoEntityId",
       g.name AS geo_entity_name,
       c."resolutionSource",
       c."order",
       c.role
FROM experience_component c
JOIN experience e ON e.id = c."experienceId"
LEFT JOIN geo_entity g ON g.id = c."geoEntityId"
WHERE c."experienceId" IN (
  SELECT "experienceId" FROM experience_component GROUP BY 1 HAVING count(*) > 1
)
ORDER BY e."createdAt", c."sourcePosition";

\echo '== Integrity: unresolved members never carry a GeoEntity; no member lost'
SELECT count(*) FILTER (WHERE "resolutionState" = 'UNRESOLVED' AND "geoEntityId" IS NOT NULL) AS unresolved_with_geo,
       count(*) FILTER (WHERE "resolutionState" = 'RESOLVED' AND "geoEntityId" IS NULL) AS resolved_without_geo,
       count(*) FILTER (WHERE "sourcePosition" IS NULL) AS without_source_position,
       count(*) FILTER (WHERE "sourceName" IS NULL) AS without_source_name
FROM experience_component;

\echo '== Tours'
SELECT t.id, t.name, t."createdAt" FROM tour t ORDER BY t."createdAt";

\echo '== TourExperience rows, with canonical member counts vs snapshot count'
SELECT te."tourId",
       te.id AS tour_experience_id,
       te."experienceId",
       e."canonicalName",
       te."dayNumber",
       te."order",
       (SELECT count(*) FROM experience_component c WHERE c."experienceId" = te."experienceId") AS canonical_source_members,
       (SELECT count(*) FROM experience_component c WHERE c."experienceId" = te."experienceId" AND c."resolutionState" = 'RESOLVED') AS canonical_resolved,
       (SELECT count(DISTINCT c."geoEntityId") FROM experience_component c WHERE c."experienceId" = te."experienceId" AND c."resolutionState" = 'RESOLVED') AS canonical_distinct_geo,
       (SELECT count(*) FROM tour_experience_component s WHERE s."tourExperienceId" = te.id) AS snapshot_components
FROM tour_experience te
LEFT JOIN experience e ON e.id = te."experienceId"
ORDER BY te."tourId", te."dayNumber", te."order";

\echo '== TourExperienceComponent snapshot rows'
SELECT s."tourExperienceId", s."order", s.name, s."geoEntityId"
FROM tour_experience_component s
ORDER BY s."tourExperienceId", s."order", s.name;

\echo '== Verified hint memory and assertions (National Bank class)'
SELECT g.id, g.name, g."verifiedHintNames"
FROM geo_entity g
WHERE cardinality(g."verifiedHintNames") > 0
ORDER BY g.name;
SELECT a."hintName", a."hintKey", a.source, a."revokedAt", g.name AS geo_entity_name
FROM geo_entity_verified_hint_assertion a
JOIN geo_entity g ON g.id = a."geoEntityId"
ORDER BY a."hintKey";
