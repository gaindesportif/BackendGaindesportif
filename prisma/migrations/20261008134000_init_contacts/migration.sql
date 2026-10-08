-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "gainde_v1";

-- CreateEnum
CREATE TYPE "ContactSubject" AS ENUM ('collection', 'personnalisation', 'partenariat', 'autre');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('new', 'in_progress', 'closed');

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(25) NOT NULL,
    "subject" "ContactSubject" NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ContactStatus" NOT NULL DEFAULT 'new',

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_requests_created_at_idx" ON "contact_requests"("created_at" DESC);
