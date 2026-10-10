CREATE TABLE "web_push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_push_subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_push_subscription_endpoint_key"
ON "web_push_subscription"("endpoint");

CREATE INDEX "web_push_subscription_userId_idx"
ON "web_push_subscription"("userId");

CREATE INDEX "web_push_subscription_enabled_idx"
ON "web_push_subscription"("enabled");

ALTER TABLE "web_push_subscription"
ADD CONSTRAINT "web_push_subscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
