/*
  Warnings:

  - Added the required column `location_geom` to the `Activity` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "location_geom" geometry(Point, 4326) NOT NULL;
