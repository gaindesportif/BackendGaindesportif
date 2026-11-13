/* Migration ciblée de la livraison Media semaine 1, utilisable dans le terminal de l’ancien backend.
   Aucun secret n’est écrit sur disque ou affiché. Aucune application n’est redéployée. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const appRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { Client } = appRequire('pg');
const revision = 'e6c885bfa4ee9ef35c07b6fac522fbbe21b73e5d';
const manifest = {
  'prisma/schema.prisma': '105810c2e5605fc9a131eb5b27ada4b39ace13c6b3c54e3eda6a1c0601a2b7b7',
  'prisma/migrations/migration_lock.toml':
    '1db17a8d051aa136110736752c5e1f8b7ed92b6ea8e803112fbbe2497047c210',
  'prisma/migrations/20261008134000_init_contacts/migration.sql':
    '6b8991a3b073ebff48ab76ea38462bc1717141f9415bf03dfa746528b8abb115',
  'prisma/migrations/20261019170000_boutique_admin/migration.sql':
    'fef61a693b37b8ce1145e63b73b7582347ba37a35561b0154b1100f680a635b8',
  'prisma/migrations/20261021210000_customer_accounts/migration.sql':
    'd0500e70c4305f4de4e068be91c13b2ee1041b4724781c972a79fa1269815891',
  'prisma/migrations/20261021223000_customer_email_notifications/migration.sql':
    '18a3427e2f7eb1fa4c8569ab542b246030aa85e27ad0158339dab8dfa2d1b1e4',
  'prisma/migrations/20261022130000_stock_categories/migration.sql':
    'ae3b5a6254415b6836a471c79295cf64c8b787e17ae2d9c8867f6b163c4a83f4',
  'prisma/migrations/20261113090000_editorial/migration.sql':
    '07c5e8ffb85c0594b85fc95498711d3ee9d284aa79e427d2654a47c29c51e64b',
  'prisma/migrations/20261113160000_editorial_featured/migration.sql':
    'a13e86b11ec422e6cbfc57a8083a3ade9351a67ee01078fecb32dfa6c61b56a5',
};
const baseline = [
  '20261008134000_init_contacts',
  '20261019170000_boutique_admin',
  '20261021210000_customer_accounts',
  '20261021223000_customer_email_notifications',
  '20261022130000_stock_categories',
];
const media = ['20261113090000_editorial', '20261113160000_editorial_featured'];
const tables = ['articles', 'article_images'];
class SafeError extends Error {}
let directory, client;
async function main() {
  const local = process.argv.includes('--local-test');
  if (!process.argv.includes('--backup-checked'))
    throw new SafeError('Vérifiez la sauvegarde récente avant de lancer avec --backup-checked.');
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new SafeError('Connexion PostgreSQL requise.');
  if (local) {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.includes('test'))
      throw new SafeError('Base locale de test requise.');
  } else {
    if (url.hostname !== 'gaindesportif-postgres-uxa2ed' || url.pathname !== '/gaindesportif')
      throw new SafeError('Cible VPS différente : opération arrêtée.');
    if (!process.env.GAINDE_MIGRATION_PASSWORD)
      throw new SafeError('Mot de passe du rôle gainde_owner à saisir en privé dans le terminal.');
    url.username = 'gainde_owner';
    url.password = process.env.GAINDE_MIGRATION_PASSWORD;
  }
  delete process.env.GAINDE_MIGRATION_PASSWORD;
  const appRole = local ? 'gainde_media_migration_app_test' : 'gainde_app';
  const backupRole = local ? 'gainde_media_migration_backup_test' : 'gainde_backup';
  url.searchParams.set('schema', 'gainde_v1');
  client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  await client.connect();
  await client.query('SELECT pg_advisory_lock(13112027)');
  const identity = (await client.query('SELECT current_user AS role')).rows[0];
  if (!local && identity.role !== 'gainde_owner') throw new SafeError('Rôle propriétaire requis.');
  const history = (
    await client.query(
      'SELECT migration_name,checksum,finished_at,rolled_back_at FROM gainde_v1._prisma_migrations',
    )
  ).rows;
  if (
    ![5, 7].includes(history.length) ||
    new Set(history.map((e) => e.migration_name)).size !== history.length
  )
    throw new SafeError('Nombre de migrations ou doublon historique inattendu.');
  for (const entry of history) {
    const expected = manifest[`prisma/migrations/${entry.migration_name}/migration.sql`];
    if (!expected || entry.checksum !== expected || !entry.finished_at || entry.rolled_back_at)
      throw new SafeError('Historique de migrations inattendu : opération arrêtée.');
  }
  for (const name of baseline)
    if (!history.some((e) => e.migration_name === name))
      throw new SafeError('Migration historique absente ; ne pas déployer.');
  if (
    history.some((e) => media.includes(e.migration_name)) &&
    !media.every((name) => history.some((e) => e.migration_name === name))
  )
    throw new SafeError('Migration Media partielle : diagnostic requis avant reprise.');
  for (const role of [appRole, backupRole])
    if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
      throw new SafeError('Rôle applicatif ou sauvegarde absent.');
  const protectedBefore = (
    await client.query(
      "SELECT has_schema_privilege($1,'gainde_v1','CREATE') AS ddl, has_table_privilege($1,'gainde_v1._prisma_migrations','INSERT,UPDATE,DELETE,TRUNCATE') AS writes",
      [appRole],
    )
  ).rows[0];
  if (protectedBefore.ddl || protectedBefore.writes)
    throw new SafeError('Privilèges applicatifs inattendus ; aucune migration lancée.');
  directory = await mkdtemp(path.join(tmpdir(), 'gainde-media-migrations-'));
  for (const [file, checksum] of Object.entries(manifest)) {
    const response = await fetch(
      `https://raw.githubusercontent.com/gaindesportif/BackendGaindesportif/${revision}/${file}`,
      { redirect: 'error', signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) throw new SafeError('Téléchargement de la migration impossible.');
    const content = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(content).digest('hex') !== checksum)
      throw new SafeError('Empreinte de migration différente : opération arrêtée.');
    const destination = path.join(directory, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, { mode: 0o600 });
  }
  const config = path.join(directory, 'prisma.config.ts');
  await writeFile(
    config,
    `import { defineConfig } from ${JSON.stringify(appRequire.resolve('prisma/config'))};\nexport default defineConfig({schema:'./prisma/schema.prisma',migrations:{path:'./prisma/migrations'},datasource:{url:process.env.DIRECT_URL}});\n`,
    { mode: 0o600 },
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(path.dirname(appRequire.resolve('prisma/config')), 'build/index.js'),
      'migrate',
      'deploy',
      '--config',
      config,
    ],
    {
      cwd: directory,
      env: { ...process.env, DIRECT_URL: url.toString(), DATABASE_URL: url.toString() },
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new SafeError(
      'Prisma n’a pas terminé la migration. Ne déployez pas les applications ; faites vérifier l’historique.',
    );
  await client.query('BEGIN');
  for (const table of tables)
    await client.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON gainde_v1.${table} TO ${appRole}; GRANT SELECT ON gainde_v1.${table} TO ${backupRole}`,
    );
  for (const table of tables) {
    const rights = (
      await client.query(
        "SELECT (has_table_privilege($1,$3,'SELECT') AND has_table_privilege($1,$3,'INSERT') AND has_table_privilege($1,$3,'UPDATE') AND has_table_privilege($1,$3,'DELETE')) AS app, has_table_privilege($2,$3,'SELECT') AS backup, has_table_privilege($2,$3,'INSERT,UPDATE,DELETE,TRUNCATE') AS forbidden, pg_get_userbyid(relowner) IN ($1,$2) AS owned FROM pg_class WHERE oid=$3::regclass",
        [appRole, backupRole, 'gainde_v1.' + table],
      )
    ).rows[0];
    if (!rights.app || !rights.backup || rights.forbidden || rights.owned)
      throw new SafeError('Droits des tables Media à vérifier avant déploiement.');
  }
  const protectedHistory = (
    await client.query(
      "SELECT has_schema_privilege($1,'gainde_v1','CREATE') AS ddl,has_table_privilege($1,'gainde_v1._prisma_migrations','INSERT,UPDATE,DELETE,TRUNCATE') AS writes",
      [appRole],
    )
  ).rows[0];
  if (protectedHistory.ddl || protectedHistory.writes)
    throw new SafeError('Le rôle applicatif a des privilèges de migration inattendus.');
  const index = (
    await client.query(
      "SELECT indisunique, indisvalid, indpred IS NOT NULL AS partial FROM pg_index WHERE indexrelid=to_regclass('gainde_v1.articles_one_published_featured')",
    )
  ).rows[0];
  if (!index?.indisunique || !index.indisvalid || !index.partial)
    throw new SafeError('Contrainte de la une absente ou invalide.');
  const count = (
    await client.query(
      'SELECT count(*)::int AS count FROM gainde_v1._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    )
  ).rows[0].count;
  if (count !== 7) throw new SafeError('Nombre de migrations inattendu.');
  await client.query('COMMIT');
  process.stdout.write(
    'MIGRATIONS_MEDIA_OK : sept migrations présentes, deux tables Media et droits vérifiés. Semaine 2 à conserver désactivée.\n',
  );
}
main()
  .catch((error) => {
    process.stderr.write(
      (error instanceof SafeError
        ? error.message
        : 'Migration Media non terminée : vérifier la connexion privée et les droits du propriétaire.') +
        '\n',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (client) await client.end().catch(() => {});
    if (directory) await rm(directory, { recursive: true, force: true });
  });
