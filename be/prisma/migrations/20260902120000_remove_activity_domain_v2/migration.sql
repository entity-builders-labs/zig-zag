-- Experience Domain V2 cutover.
--
-- The Activity schema was never promoted to production.  Remove it as a
-- versioned, idempotent migration so fresh environments (including AWS) can
-- replay the same cutover after applying the historical migrations, while a
-- local database that was already cleaned remains safe to deploy.

DROP TABLE IF EXISTS "tour_activity_waypoint" CASCADE;
DROP TABLE IF EXISTS "tour_activity" CASCADE;
DROP TABLE IF EXISTS "activity_waypoint" CASCADE;
DROP TABLE IF EXISTS "activity_relationship" CASCADE;
DROP TABLE IF EXISTS "activity_family" CASCADE;
DROP TABLE IF EXISTS "known_activity_types" CASCADE;
DROP TABLE IF EXISTS "activity" CASCADE;

DROP TYPE IF EXISTS "ActivityKind";
DROP TYPE IF EXISTS "RelationType";
DROP TYPE IF EXISTS "VariantTheme";
