/*
  Warnings:

  - A unique constraint covering the columns `[latitude,longitude]` on the table `Activity` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Activity_latitude_longitude_key" ON "Activity"("latitude", "longitude");
