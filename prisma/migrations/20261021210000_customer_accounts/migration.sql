-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(256) NOT NULL,
    "recovery_code_hash" VARCHAR(64) NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "history_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "account_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_wishlist" (
    "account_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_wishlist_pkey" PRIMARY KEY ("account_id","product_id")
);

-- CreateTable
CREATE TABLE "customer_product_views" (
    "account_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_product_views_pkey" PRIMARY KEY ("account_id","product_id")
);

-- CreateTable
CREATE TABLE "customer_prepared_requests" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "product_id" UUID,
    "request_key" UUID NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "product_name" VARCHAR(160) NOT NULL,
    "product_slug" VARCHAR(180) NOT NULL,
    "price_xof" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "size" VARCHAR(40),
    "color" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_prepared_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "customer_sessions_account_id_idx" ON "customer_sessions"("account_id");

-- CreateIndex
CREATE INDEX "customer_sessions_expires_at_idx" ON "customer_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "customer_wishlist_product_id_idx" ON "customer_wishlist"("product_id");

-- CreateIndex
CREATE INDEX "customer_product_views_account_id_viewed_at_idx" ON "customer_product_views"("account_id", "viewed_at" DESC);

-- CreateIndex
CREATE INDEX "customer_product_views_product_id_idx" ON "customer_product_views"("product_id");

-- CreateIndex
CREATE INDEX "customer_prepared_requests_account_id_created_at_idx" ON "customer_prepared_requests"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customer_prepared_requests_product_id_idx" ON "customer_prepared_requests"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_prepared_requests_account_id_request_key_key" ON "customer_prepared_requests"("account_id", "request_key");

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wishlist" ADD CONSTRAINT "customer_wishlist_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wishlist" ADD CONSTRAINT "customer_wishlist_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_product_views" ADD CONSTRAINT "customer_product_views_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_product_views" ADD CONSTRAINT "customer_product_views_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_prepared_requests" ADD CONSTRAINT "customer_prepared_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_prepared_requests" ADD CONSTRAINT "customer_prepared_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
