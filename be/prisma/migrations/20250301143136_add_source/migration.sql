/*
  Warnings:

  - A unique constraint covering the columns `[sourceId,externalId]` on the table `activity` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `externalId` to the `activity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sourceId` to the `activity` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "activity_latitude_longitude_key";

-- AlterTable
ALTER TABLE "activity" ADD COLUMN     "externalId" TEXT NOT NULL,
ADD COLUMN     "sourceId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_name_key" ON "source"("name");

-- CreateIndex
CREATE UNIQUE INDEX "activity_sourceId_externalId_key" ON "activity"("sourceId", "externalId");

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
