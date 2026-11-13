ALTER TABLE "gainde_v1"."articles" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
-- A single published front-page article; drafts may prepare their selection independently.
CREATE UNIQUE INDEX "articles_one_published_featured" ON "gainde_v1"."articles" ("featured")
WHERE "featured" = true AND "status" = 'published';
CREATE INDEX "articles_status_featured_published_at_idx"
ON "gainde_v1"."articles" ("status", "featured" DESC, "published_at" DESC);
