BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE "gainde_v1"."products" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "gainde_v1"."product_categories" (
  "slug" VARCHAR(80) PRIMARY KEY,
  "label" VARCHAR(80) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "gainde_v1"."product_categories" ("slug", "label") VALUES
 ('maillots', 'Maillots'), ('t-shirts-polos', 'T-shirts et polos'),
 ('shorts', 'Shorts'), ('survetements', 'Survêtements'),
 ('chaussures', 'Chaussures'), ('accessoires', 'Accessoires'), ('equipements', 'Équipements');
-- Conserver les anciennes affectations sans inventer une nouvelle classification.
INSERT INTO "gainde_v1"."product_categories" ("slug", "label", "active")
 SELECT DISTINCT "category", "category", false FROM "gainde_v1"."products"
 ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "gainde_v1"."product_categories" ("slug", "label", "active") VALUES
 ('', 'Catégorie à choisir', false) ON CONFLICT DO NOTHING;
ALTER TABLE "gainde_v1"."products" ADD COLUMN "stock_quantity" INTEGER;
ALTER TABLE "gainde_v1"."products" ADD CONSTRAINT "products_stock_nonnegative"
 CHECK ("stock_quantity" IS NULL OR "stock_quantity" >= 0);
ALTER TABLE "gainde_v1"."products" ADD CONSTRAINT "products_category_fkey"
 FOREIGN KEY ("category") REFERENCES "gainde_v1"."product_categories"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Les anciennes quantités restent inconnues : l'administrateur doit les renseigner.
COMMIT;
