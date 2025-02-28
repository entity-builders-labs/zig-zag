/*
  Warnings:

  - A unique constraint covering the columns `[coords]` on the table `activity` will be added. If there are existing duplicate values, this will fail.
  - Made the column `coords` on table `activity` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "activity_latitude_longitude_idx";

-- DropIndex
DROP INDEX "activity_latitude_longitude_key";

-- AlterTable
ALTER TABLE "activity" ALTER COLUMN "coords" SET NOT NULL;

-- CreateIndex
CREATE INDEX "activity_coords_idx" ON "activity" USING GIST ("coords");

-- CreateIndex
CREATE UNIQUE INDEX "activity_coords_key" ON "activity"("coords");
