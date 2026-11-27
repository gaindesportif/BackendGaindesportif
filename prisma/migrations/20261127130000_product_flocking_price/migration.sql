ALTER TABLE "gainde_v1"."products"
ADD COLUMN "flocking_price_xof" INTEGER,
ADD CONSTRAINT "products_flocking_price_check" CHECK (
  "flocking_price_xof" IS NULL OR (
    "category" = 'maillots'
    AND "flocking_price_xof" > 0
    AND COALESCE("price_xof", 0)::bigint + "flocking_price_xof" <= 2147483647
  )
);
