/*
  Warnings:

  - Added the required column `formattedAddress` to the `Activity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `latitude` to the `Activity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `longitude` to the `Activity` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `location` on the `Activity` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "formattedAddress" TEXT NOT NULL,
ADD COLUMN     "latitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "longitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "placeId" TEXT,
DROP COLUMN "location",
ADD COLUMN     "location" JSONB NOT NULL;

-- CreateIndex
CREATE INDEX "Activity_latitude_longitude_idx" ON "Activity"("latitude", "longitude");
