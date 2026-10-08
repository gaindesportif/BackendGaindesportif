import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Client applicatif : pooler Neon. Migrations : connexion directe, schéma isolé.
// La valeur locale de repli sert à générer le client en CI, sans ouvrir de connexion.
const url = new URL(
  process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://ci:ci@localhost:5432/gainde',
);
if (!process.env.DIRECT_URL) url.hostname = url.hostname.replace(/-pooler(?=\.)/, '');
url.searchParams.set('schema', 'gainde_v1');
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: url.toString() },
});
