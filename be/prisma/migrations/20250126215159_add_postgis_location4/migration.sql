/*
  Warnings:

  - You are about to drop the column `location_geom` on the `Activity` table. All the data in the column will be lost.
  - Added the required column `coords` to the `Activity` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Activity_latitude_longitude_idx";

-- AlterTable
ALTER TABLE "Activity" DROP COLUMN "location_geom",
ADD COLUMN     "coords" geometry(Point, 4326) NOT NULL;

-- CreateIndex
CREATE INDEX "location_idx" ON "Activity" USING GIST ("coords");
