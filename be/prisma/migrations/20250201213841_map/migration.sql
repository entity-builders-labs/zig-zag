/*
  Warnings:

  - A unique constraint covering the columns `[latitude,longitude]` on the table `activity` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "activity_coords_idx";

-- DropIndex
DROP INDEX "activity_coords_key";

-- CreateIndex
CREATE INDEX "activity_latitude_longitude_idx" ON "activity"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "activity_latitude_longitude_key" ON "activity"("latitude", "longitude");
