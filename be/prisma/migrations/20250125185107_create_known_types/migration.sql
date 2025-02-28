/*
  Warnings:

  - You are about to drop the column `additionalDetails` on the `Activity` table. All the data in the column will be lost.
  - You are about to drop the column `formattedAddress` on the `Activity` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Activity` table. All the data in the column will be lost.
  - You are about to drop the column `openingHours` on the `Activity` table. All the data in the column will be lost.
  - The `difficulty` column on the `Activity` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `price` on the `Tour` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,2)` to `DoublePrecision`.
  - You are about to alter the column `duration` on the `Tour` table. The data in that column could be lost. The data in that column will be cast from `Decimal(4,1)` to `DoublePrecision`.
  - The primary key for the `TourActivity` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `duration` on the `TourActivity` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `TourActivity` table. All the data in the column will be lost.
  - You are about to drop the column `order` on the `TourActivity` table. All the data in the column will be lost.
  - Added the required column `maxGroupSize` to the `Activity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `Activity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `Activity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `duration` to the `Activity` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `Activity` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Activity" DROP COLUMN "additionalDetails",
DROP COLUMN "formattedAddress",
DROP COLUMN "name",
DROP COLUMN "openingHours",
ADD COLUMN     "maxGroupSize" INTEGER NOT NULL,
ADD COLUMN     "price" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "title" VARCHAR(255) NOT NULL,
ALTER COLUMN "description" DROP NOT NULL,
DROP COLUMN "duration",
ADD COLUMN     "duration" DOUBLE PRECISION NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" TEXT NOT NULL,
DROP COLUMN "difficulty",
ADD COLUMN     "difficulty" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Tour" ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "duration" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TourActivity" DROP CONSTRAINT "TourActivity_pkey",
DROP COLUMN "duration",
DROP COLUMN "id",
DROP COLUMN "order",
ADD CONSTRAINT "TourActivity_pkey" PRIMARY KEY ("tourId", "activityId");

-- DropEnum
DROP TYPE "ActivityType";

-- DropEnum
DROP TYPE "DifficultyLevel";

-- CreateTable
CREATE TABLE "known_activity_types" (
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "known_activity_types_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "Activity_type_idx" ON "Activity"("type");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_type_fkey" FOREIGN KEY ("type") REFERENCES "known_activity_types"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
