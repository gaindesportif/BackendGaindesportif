CREATE TABLE "gainde_v1"."media_push_subscriptions" (
    "id" TEXT PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "p256dh" VARCHAR(87) NOT NULL,
    "auth" VARCHAR(22) NOT NULL
);

CREATE TABLE "gainde_v1"."media_push_deliveries" (
    "article_id" UUID NOT NULL REFERENCES "gainde_v1"."articles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "subscription_id" TEXT NOT NULL REFERENCES "gainde_v1"."media_push_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    PRIMARY KEY ("article_id", "subscription_id")
);

CREATE INDEX "media_push_deliveries_next_attempt_at_idx" ON "gainde_v1"."media_push_deliveries" ("next_attempt_at");
CREATE INDEX "media_push_deliveries_subscription_id_idx" ON "gainde_v1"."media_push_deliveries" ("subscription_id");
