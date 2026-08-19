-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('POI', 'NEIGHBORHOOD_WALK', 'ROUTE', 'AREA', 'EXPERIENCE');

-- CreateEnum
CREATE TYPE "VariantTheme" AS ENUM ('HISTORY', 'ART', 'FOOD', 'NATURE', 'ARCHITECTURE', 'NIGHTLIFE', 'SHOPPING', 'FAMILY', 'TANGO', 'PHOTOGRAPHY', 'QUICK', 'DEEP_DIVE');

-- AlterTable
ALTER TABLE "activity" ADD COLUMN     "boundary" JSONB,
ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isCurated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "ActivityKind" NOT NULL DEFAULT 'POI',
ADD COLUMN     "variantTheme" "VariantTheme";

-- CreateTable
CREATE TABLE "activity_family" (
    "id" TEXT NOT NULL,
    "areaActivityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_waypoint" (
    "id" TEXT NOT NULL,
    "compositeActivityId" TEXT NOT NULL,
    "waypointActivityId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_waypoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_activity_waypoint" (
    "id" TEXT NOT NULL,
    "tourActivityId" TEXT NOT NULL,
    "waypointActivityId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_activity_waypoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_family_areaActivityId_kind_key" ON "activity_family"("areaActivityId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "activity_waypoint_compositeActivityId_waypointActivityId_key" ON "activity_waypoint"("compositeActivityId", "waypointActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "activity_waypoint_compositeActivityId_order_key" ON "activity_waypoint"("compositeActivityId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "tour_activity_waypoint_tourActivityId_waypointActivityId_key" ON "tour_activity_waypoint"("tourActivityId", "waypointActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "tour_activity_waypoint_tourActivityId_order_key" ON "tour_activity_waypoint"("tourActivityId", "order");

-- CreateIndex
CREATE INDEX "activity_kind_idx" ON "activity"("kind");

-- CreateIndex
CREATE INDEX "activity_familyId_idx" ON "activity"("familyId");

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "activity_family"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_family" ADD CONSTRAINT "activity_family_areaActivityId_fkey" FOREIGN KEY ("areaActivityId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_waypoint" ADD CONSTRAINT "activity_waypoint_compositeActivityId_fkey" FOREIGN KEY ("compositeActivityId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_waypoint" ADD CONSTRAINT "activity_waypoint_waypointActivityId_fkey" FOREIGN KEY ("waypointActivityId") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_activity_waypoint" ADD CONSTRAINT "tour_activity_waypoint_tourActivityId_fkey" FOREIGN KEY ("tourActivityId") REFERENCES "tour_activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_activity_waypoint" ADD CONSTRAINT "tour_activity_waypoint_waypointActivityId_fkey" FOREIGN KEY ("waypointActivityId") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
