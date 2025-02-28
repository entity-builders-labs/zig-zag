-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TREKKING', 'RELAXATION', 'SHOPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "DifficultyLevel" AS ENUM ('EASY', 'MODERATE', 'HARD');

-- CreateTable
CREATE TABLE "Activity" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "duration" TEXT,
    "type" "ActivityType" NOT NULL,
    "location" TEXT NOT NULL,
    "openingHours" TEXT,
    "difficulty" "DifficultyLevel",
    "additionalDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);
