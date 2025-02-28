/*
  Warnings:

  - You are about to drop the column `placeId` on the `activity` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "activity_latitude_longitude_idx";

-- AlterTable
ALTER TABLE "activity" DROP COLUMN "placeId";
