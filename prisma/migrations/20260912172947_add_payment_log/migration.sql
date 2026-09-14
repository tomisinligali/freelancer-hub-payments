-- CreateEnum
CREATE TYPE "PaymentLogStatus" AS ENUM ('UNVERIFIED', 'SUCCESSFUL', 'PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "PaymentLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "checkoutSessionId" TEXT,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "plan" "Plan",
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "txRef" TEXT,
    "providerTransactionId" TEXT,
    "providerSubscriptionId" TEXT,
    "verificationStatus" "PaymentLogStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "rawPayload" JSONB,
    "verificationResult" JSONB,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentLog_userId_idx" ON "PaymentLog"("userId");

-- CreateIndex
CREATE INDEX "PaymentLog_txRef_idx" ON "PaymentLog"("txRef");

-- CreateIndex
CREATE INDEX "PaymentLog_type_idx" ON "PaymentLog"("type");

-- CreateIndex
CREATE INDEX "PaymentLog_userId_createdAt_idx" ON "PaymentLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentLog" ADD CONSTRAINT "PaymentLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLog" ADD CONSTRAINT "PaymentLog_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
