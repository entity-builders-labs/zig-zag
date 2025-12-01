-- AlterTable
ALTER TABLE "tour" ADD COLUMN IF NOT EXISTS "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tour_categories_idx" ON "tour"("categories");
