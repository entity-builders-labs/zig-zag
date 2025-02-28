-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('SEQUENTIAL', 'SIMILAR', 'COMPLEMENTARY');

-- CreateTable
CREATE TABLE "activity_relationship" (
    "source_activity_id" INTEGER NOT NULL,
    "target_activity_id" INTEGER NOT NULL,
    "relation_type" "RelationType" NOT NULL,
    "compatibility_score" INTEGER NOT NULL,
    "time_compatibility_score" INTEGER NOT NULL,
    "distance_score" INTEGER NOT NULL,
    "variety_score" INTEGER NOT NULL,
    "time_gap_recommended" INTEGER,
    "reasoning" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_relationship_pkey" PRIMARY KEY ("source_activity_id","target_activity_id")
);

-- CreateIndex
CREATE INDEX "activity_relationship_source_activity_id_idx" ON "activity_relationship"("source_activity_id");

-- CreateIndex
CREATE INDEX "activity_relationship_target_activity_id_idx" ON "activity_relationship"("target_activity_id");

-- CreateIndex
CREATE INDEX "activity_relationship_compatibility_score_time_compatibilit_idx" ON "activity_relationship"("compatibility_score", "time_compatibility_score", "distance_score", "variety_score");

-- AddForeignKey
ALTER TABLE "activity_relationship" ADD CONSTRAINT "activity_relationship_source_activity_id_fkey" FOREIGN KEY ("source_activity_id") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_relationship" ADD CONSTRAINT "activity_relationship_target_activity_id_fkey" FOREIGN KEY ("target_activity_id") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
