-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_type_fkey";

-- DropIndex
DROP INDEX "Activity_type_idx";

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "knownActivityTypeName" TEXT;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_knownActivityTypeName_fkey" FOREIGN KEY ("knownActivityTypeName") REFERENCES "known_activity_types"("name") ON DELETE SET NULL ON UPDATE CASCADE;
