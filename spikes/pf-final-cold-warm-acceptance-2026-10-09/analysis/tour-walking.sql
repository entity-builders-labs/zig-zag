-- Persisted Tour ordering, durations and inbound walking legs (read-only).
--   docker exec -i zigzag-postgres psql -U postgres -d <db> -v tour="'<tour-id>'" < tour-walking.sql
SELECT te."order", te."experienceId", e."canonicalName", e."durationMinutes",
       te.duration, te."travelFromPrevious"
FROM tour_experience te JOIN experience e ON e.id = te."experienceId"
WHERE te."tourId" = :tour ORDER BY te."dayNumber", te."order";
SELECT count(*) AS total, count(*) FILTER (WHERE "durationMinutes" IS NULL) AS dur_null,
       count(*) FILTER (WHERE "durationMinutes" = 120) AS dur_120
FROM experience;
SELECT id, "canonicalName", "durationMinutes" FROM experience WHERE "durationMinutes" IS NOT NULL;
