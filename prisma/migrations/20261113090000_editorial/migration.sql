CREATE TABLE "gainde_v1"."articles" (
 "id" UUID NOT NULL, "slug" VARCHAR(200) NOT NULL, "title" VARCHAR(160) NOT NULL,
 "excerpt" VARCHAR(400) NOT NULL DEFAULT '', "body" TEXT NOT NULL DEFAULT '',
 "category" VARCHAR(30) NOT NULL DEFAULT 'actualites', "author" VARCHAR(100) NOT NULL DEFAULT '',
 "status" VARCHAR(20) NOT NULL DEFAULT 'draft', "version" INTEGER NOT NULL DEFAULT 1,
 "published_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "articles_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "articles_status_check" CHECK ("status" IN ('draft','published','deleting')),
 CONSTRAINT "articles_category_check" CHECK ("category" IN ('actualites','interviews','reportages','analyses'))
);
CREATE UNIQUE INDEX "articles_slug_key" ON "gainde_v1"."articles"("slug");
CREATE INDEX "articles_status_published_at_idx" ON "gainde_v1"."articles"("status", "published_at" DESC);
CREATE TABLE "gainde_v1"."article_images" (
 "id" UUID NOT NULL, "article_id" UUID NOT NULL, "public_id" VARCHAR(240) NOT NULL,
 "state" VARCHAR(20) NOT NULL DEFAULT 'pending', "url" TEXT NOT NULL DEFAULT '',
 "alt" VARCHAR(200) NOT NULL DEFAULT '', "caption" VARCHAR(300) NOT NULL DEFAULT '', "credit" VARCHAR(100) NOT NULL DEFAULT '',
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expires_at" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "article_images_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "article_images_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "gainde_v1"."articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "article_images_state_check" CHECK ("state" IN ('pending','ready','deleting'))
);
CREATE UNIQUE INDEX "article_images_public_id_key" ON "gainde_v1"."article_images"("public_id");
CREATE INDEX "article_images_article_id_state_idx" ON "gainde_v1"."article_images"("article_id", "state");
