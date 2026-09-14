-- Money is stored as whole numbers in minor units (kobo) alongside the currency.
-- Existing Decimal values (naira) are scaled x100 to preserve amounts in kobo.
ALTER TABLE "CheckoutSession" ALTER COLUMN "amount" SET DATA TYPE INTEGER USING (ROUND("amount" * 100));
ALTER TABLE "PaymentLog" ALTER COLUMN "amount" SET DATA TYPE INTEGER USING (CASE WHEN "amount" IS NULL THEN NULL ELSE ROUND("amount" * 100) END);
ALTER TABLE "SubscriptionEvent" ALTER COLUMN "amount" SET DATA TYPE INTEGER USING (ROUND("amount" * 100));
ALTER TABLE "SubscriptionEvent" ALTER COLUMN "currency" SET DEFAULT 'NGN';