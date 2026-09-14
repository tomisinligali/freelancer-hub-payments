-- Optional cancellation reason captured from the post-cancellation prompt.
ALTER TABLE "Subscription" ADD COLUMN "cancellationReason" TEXT;