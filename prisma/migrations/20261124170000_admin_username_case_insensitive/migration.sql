BEGIN;

-- Block account writes until the collision check and index creation are complete.
LOCK TABLE "gainde_v1"."admin_accounts" IN SHARE MODE;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "gainde_v1"."admin_accounts"
        GROUP BY lower("username")
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Des identifiants administrateur diffèrent uniquement par la casse. Résolvez les collisions avant de réessayer.';
    END IF;
END $$;

CREATE UNIQUE INDEX "admin_accounts_username_lower_key"
    ON "gainde_v1"."admin_accounts" (lower("username"));

COMMIT;
