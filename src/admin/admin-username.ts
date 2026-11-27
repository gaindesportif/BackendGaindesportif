import type { AdminAccount, Prisma } from '../generated/prisma/client';

export async function findAdminByUsername(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  username: string,
) {
  // Match the expression in the unique index while preserving the stored spelling.
  const accounts = await db.$queryRaw<AdminAccount[]>`
    SELECT id, username, display_name AS "displayName", password_hash AS "passwordHash",
           role::text AS role, active, created_at AS "createdAt"
    FROM gainde_v1.admin_accounts
    WHERE lower(username) = lower(${username})
    LIMIT 2
  `;
  // Fail closed if called on a database with legacy duplicates before migration.
  return accounts.length === 1 ? accounts[0] : null;
}
