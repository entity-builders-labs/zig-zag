/*
  Warnings:

  - You are about to drop the column `coords` on the `Activity` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "location_idx";

-- AlterTable
ALTER TABLE "Activity" DROP COLUMN "coords";

-- CreateIndex
CREATE INDEX "Activity_latitude_longitude_idx" ON "Activity"("latitude", "longitude");
