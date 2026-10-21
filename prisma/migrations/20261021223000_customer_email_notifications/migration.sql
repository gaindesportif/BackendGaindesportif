-- CreateEnum
CREATE TYPE "CustomerRequestStatus" AS ENUM ('prepared', 'received', 'shipped', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "CustomerEmailPurpose" AS ENUM ('verify_email', 'reset_password');

-- AlterTable
ALTER TABLE "customer_accounts" DROP COLUMN "recovery_code_hash",
ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "customer_prepared_requests" ADD COLUMN     "processing_status" "CustomerRequestStatus" NOT NULL DEFAULT 'prepared',
ADD COLUMN     "status_updated_at" TIMESTAMPTZ(3),
ADD COLUMN     "status_updated_by" UUID,
ADD COLUMN     "status_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customer_email_tokens" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "purpose" "CustomerEmailPurpose" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_outbox" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "dedupe_key" VARCHAR(180) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "payload" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_email_tokens_token_hash_key" ON "customer_email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "customer_email_tokens_account_id_purpose_idx" ON "customer_email_tokens"("account_id", "purpose");

-- CreateIndex
CREATE INDEX "customer_email_tokens_expires_at_idx" ON "customer_email_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mail_outbox_dedupe_key_key" ON "mail_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "mail_outbox_status_available_at_idx" ON "mail_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "mail_outbox_account_id_created_at_idx" ON "mail_outbox"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "customer_email_tokens" ADD CONSTRAINT "customer_email_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
