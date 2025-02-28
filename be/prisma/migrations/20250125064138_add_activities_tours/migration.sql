-- CreateTable
CREATE TABLE "TourActivity" (
    "tourId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourActivity_pkey" PRIMARY KEY ("tourId","activityId")
);

-- CreateIndex
CREATE INDEX "TourActivity_tourId_idx" ON "TourActivity"("tourId");

-- CreateIndex
CREATE INDEX "TourActivity_activityId_idx" ON "TourActivity"("activityId");

-- AddForeignKey
ALTER TABLE "TourActivity" ADD CONSTRAINT "TourActivity_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourActivity" ADD CONSTRAINT "TourActivity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
