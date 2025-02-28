/*
  Warnings:

  - The primary key for the `TourActivity` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "TourActivity" DROP CONSTRAINT "TourActivity_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "TourActivity_pkey" PRIMARY KEY ("id");
