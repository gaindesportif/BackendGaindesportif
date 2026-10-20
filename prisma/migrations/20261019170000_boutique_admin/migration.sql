-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('owner', 'admin');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'published', 'deleting');

-- CreateEnum
CREATE TYPE "MediaState" AS ENUM ('pending', 'ready', 'deleting');

-- CreateTable
CREATE TABLE "admin_accounts" (
    "id" UUID NOT NULL,
    "username" VARCHAR(60) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(256) NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'admin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "account_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(6000) NOT NULL DEFAULT '',
    "category" VARCHAR(80) NOT NULL DEFAULT '',
    "price_xof" INTEGER,
    "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "colors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availability" VARCHAR(40) NOT NULL DEFAULT 'on_request',
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "public_id" VARCHAR(240) NOT NULL,
    "resource_type" VARCHAR(10) NOT NULL,
    "state" "MediaState" NOT NULL DEFAULT 'pending',
    "secure_url" VARCHAR(1000),
    "alt" VARCHAR(160) NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER,
    "format" VARCHAR(16),
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_accounts_username_key" ON "admin_accounts"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_account_id_idx" ON "admin_sessions"("account_id");

-- CreateIndex
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_status_created_at_idx" ON "products"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_media_public_id_key" ON "product_media"("public_id");

-- CreateIndex
CREATE INDEX "product_media_product_id_state_position_idx" ON "product_media"("product_id", "state", "position");

-- CreateIndex
CREATE INDEX "product_media_state_next_attempt_at_idx" ON "product_media"("state", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "admin_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

