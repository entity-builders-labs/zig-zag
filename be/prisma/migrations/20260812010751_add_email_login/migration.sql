-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'EMAIL';

-- CreateTable
CREATE TABLE "email_login_code" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_login_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_login_code_email_idx" ON "email_login_code"("email");
