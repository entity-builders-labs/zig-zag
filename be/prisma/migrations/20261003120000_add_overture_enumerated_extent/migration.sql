-- RW4-ID-CORRESPONDENCE-1: an operational AOI snapshot declares, as typed
-- columns, the extent inside which it holds every release record.
ALTER TABLE "overture_places_import_session"
  ADD COLUMN "extentWest" DOUBLE PRECISION,
  ADD COLUMN "extentSouth" DOUBLE PRECISION,
  ADD COLUMN "extentEast" DOUBLE PRECISION,
  ADD COLUMN "extentNorth" DOUBLE PRECISION;

-- One-time translation of the extent previously recorded only in the
-- untyped manifest. Only a published AOI import whose manifest states that
-- every scanned record in its bbox was imported qualifies; any other row
-- keeps a null extent (no completeness claim).
UPDATE "overture_places_import_session"
SET
  "extentWest"  = ("manifest"->'operationalBoundary'->'bbox'->>0)::DOUBLE PRECISION,
  "extentSouth" = ("manifest"->'operationalBoundary'->'bbox'->>1)::DOUBLE PRECISION,
  "extentEast"  = ("manifest"->'operationalBoundary'->'bbox'->>2)::DOUBLE PRECISION,
  "extentNorth" = ("manifest"->'operationalBoundary'->'bbox'->>3)::DOUBLE PRECISION
WHERE "expectedSourceCoverage" = 'OPERATIONAL_AOI'
  AND "status" = 'PUBLISHED'
  AND jsonb_array_length("manifest"->'operationalBoundary'->'bbox') = 4
  AND ("manifest"->>'recordsScanned') IS NOT NULL
  AND ("manifest"->>'recordsScanned') = ("manifest"->>'recordsImported');
