-- CreateTable
CREATE TABLE "user_device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_device_expoPushToken_key" ON "user_device"("expoPushToken");

-- CreateIndex
CREATE INDEX "user_device_userId_idx" ON "user_device"("userId");

-- CreateIndex
CREATE INDEX "user_device_enabled_idx" ON "user_device"("enabled");

-- AddForeignKey
ALTER TABLE "user_device" ADD CONSTRAINT "user_device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
