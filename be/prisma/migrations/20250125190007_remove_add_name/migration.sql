/*
  Warnings:

  - You are about to drop the column `title` on the `Activity` table. All the data in the column will be lost.
  - The `difficulty` column on the `Activity` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `name` to the `Activity` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- AlterTable
ALTER TABLE "Activity" DROP COLUMN "title",
ADD COLUMN     "name" VARCHAR(255) NOT NULL,
DROP COLUMN "difficulty",
ADD COLUMN     "difficulty" "Difficulty" NOT NULL DEFAULT 'EASY';
