/* Migration ciblée de la livraison comptes clients, utilisable dans le terminal de l’ancien backend.
   Aucun secret n’est écrit sur disque ou affiché. Aucune application n’est redéployée. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const appRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { Client } = appRequire('pg');
const revision = '5e6d32aaef1254aabfb57ff6ae17ffc0b5a0b9a2';
const manifest = {
  'prisma/schema.prisma': 'e8b5d1c0af8cafb70304e5cb38646d98ee23cb1183662fb623df32d265f90922',
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
};
const tables = [
  'customer_accounts',
  'customer_sessions',
  'customer_wishlist',
  'customer_product_views',
  'customer_prepared_requests',
  'customer_email_tokens',
  'mail_outbox',
];
let directory, client;
async function main() {
  const local = process.argv.includes('--local-test');
  if (!process.argv.includes('--backup-checked'))
    throw new Error('Vérifiez la sauvegarde récente avant de lancer avec --backup-checked.');
  const url = new URL(process.env.DATABASE_URL || '');
  if (local) {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.includes('test'))
      throw new Error('Base locale de test requise.');
  } else {
    if (url.hostname !== 'gaindesportif-postgres-uxa2ed' || url.pathname !== '/gaindesportif')
      throw new Error('Cible VPS différente : opération arrêtée.');
    if (!process.env.GAINDE_MIGRATION_PASSWORD)
      throw new Error('Mot de passe du rôle gainde_owner à saisir en privé dans le terminal.');
    url.username = 'gainde_owner';
    url.password = process.env.GAINDE_MIGRATION_PASSWORD;
  }
  delete process.env.GAINDE_MIGRATION_PASSWORD;
  url.searchParams.set('schema', 'gainde_v1');
  client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  await client.connect();
  const history = (
    await client.query(
      'SELECT migration_name,checksum,finished_at,rolled_back_at FROM gainde_v1._prisma_migrations',
    )
  ).rows;
  for (const entry of history) {
    const expected = manifest[`prisma/migrations/${entry.migration_name}/migration.sql`];
    if (!expected || entry.checksum !== expected || !entry.finished_at || entry.rolled_back_at)
      throw new Error('Historique de migrations inattendu : opération arrêtée.');
  }
  for (const name of ['20261008134000_init_contacts', '20261019170000_boutique_admin'])
    if (!history.some((e) => e.migration_name === name))
      throw new Error('Migration historique absente.');
  for (const role of ['gainde_app', 'gainde_backup'])
    if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
      throw new Error('Rôle applicatif ou sauvegarde absent.');
  directory = await mkdtemp(path.join(tmpdir(), 'gainde-customer-migrations-'));
  for (const [file, checksum] of Object.entries(manifest)) {
    const response = await fetch(
      `https://raw.githubusercontent.com/gaindesportif/BackendGaindesportif/${revision}/${file}`,
      { redirect: 'error', signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) throw new Error('Téléchargement de la migration impossible.');
    const content = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(content).digest('hex') !== checksum)
      throw new Error('Empreinte de migration différente : opération arrêtée.');
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
    throw new Error(
      'Prisma n’a pas terminé la migration. Ne déployez pas les applications ; faites vérifier l’historique.',
    );
  for (const table of tables)
    await client.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON gainde_v1.${table} TO gainde_app; GRANT SELECT ON gainde_v1.${table} TO gainde_backup`,
    );
  for (const table of tables) {
    const {
      rows: [rights],
    } = await client.query(
      "SELECT (has_table_privilege('gainde_app',$1,'SELECT') AND has_table_privilege('gainde_app',$1,'INSERT') AND has_table_privilege('gainde_app',$1,'UPDATE') AND has_table_privilege('gainde_app',$1,'DELETE')) AS app, has_table_privilege('gainde_backup',$1,'SELECT') AS backup, has_table_privilege('gainde_backup',$1,'INSERT,UPDATE,DELETE') AS forbidden",
      ['gainde_v1.' + table],
    );
    if (!rights.app || !rights.backup || rights.forbidden)
      throw new Error('Droits des nouvelles tables à vérifier avant déploiement.');
  }
  const {
    rows: [protectedHistory],
  } = await client.query(
    "SELECT has_schema_privilege('gainde_app','gainde_v1','CREATE') AS ddl,has_table_privilege('gainde_app','gainde_v1._prisma_migrations','INSERT,UPDATE,DELETE') AS writes",
  );
  if (protectedHistory.ddl || protectedHistory.writes)
    throw new Error('Le rôle applicatif a des privilèges de migration inattendus.');
  const count = (
    await client.query(
      'SELECT count(*)::int AS count FROM gainde_v1._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    )
  ).rows[0].count;
  if (count !== 4) throw new Error('Nombre de migrations inattendu.');
  process.stdout.write(
    'MIGRATIONS_CLIENTS_OK : quatre migrations appliquées, sept tables clientes et droits vérifiés. La base reste en fonctionnement.\n',
  );
}
main()
  .catch((error) => {
    const known = error instanceof Error && !('code' in error);
    process.stderr.write(
      (known
        ? error.message
        : 'Migration non terminée : vérifiez la connexion privée et les droits du rôle propriétaire.') +
        '\n',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (client) await client.end().catch(() => {});
    if (directory) await rm(directory, { recursive: true, force: true });
  });
