/*
  Warnings:

  - You are about to drop the `Activity` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Tour` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TourActivity` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_knownActivityTypeName_fkey";

-- DropForeignKey
ALTER TABLE "TourActivity" DROP CONSTRAINT "TourActivity_activityId_fkey";

-- DropForeignKey
ALTER TABLE "TourActivity" DROP CONSTRAINT "TourActivity_tourId_fkey";

-- DropTable
DROP TABLE "Activity";

-- DropTable
DROP TABLE "Tour";

-- DropTable
DROP TABLE "TourActivity";

-- CreateTable
CREATE TABLE "activity" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'EASY',
    "type" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "maxGroupSize" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" JSONB NOT NULL,
    "placeId" TEXT,
    "coords" geometry(Point, 4326),
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER,
    "formattedAddress" TEXT,
    "phoneNumber" TEXT,
    "website" TEXT,
    "businessStatus" TEXT,
    "priceLevel" INTEGER,
    "photos" JSONB,
    "openingHours" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "knownActivityTypeName" TEXT,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "maxGroupSize" INTEGER NOT NULL,
    "startDates" TIMESTAMP(3)[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_activity" (
    "tourId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "order" SERIAL NOT NULL,

    CONSTRAINT "tour_activity_pkey" PRIMARY KEY ("tourId","activityId")
);

-- CreateIndex
CREATE INDEX "activity_latitude_longitude_idx" ON "activity"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "activity_latitude_longitude_key" ON "activity"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "tour_activity_tourId_idx" ON "tour_activity"("tourId");

-- CreateIndex
CREATE INDEX "tour_activity_activityId_idx" ON "tour_activity"("activityId");

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_knownActivityTypeName_fkey" FOREIGN KEY ("knownActivityTypeName") REFERENCES "known_activity_types"("name") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_activity" ADD CONSTRAINT "tour_activity_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "tour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_activity" ADD CONSTRAINT "tour_activity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
