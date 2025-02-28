-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "businessStatus" TEXT,
ADD COLUMN     "formattedAddress" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "photos" JSONB,
ADD COLUMN     "priceLevel" INTEGER,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "ratingCount" INTEGER,
ADD COLUMN     "website" TEXT;
