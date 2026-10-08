import 'dotenv/config';
import { Pool } from 'pg';
import { validateEnvironment } from '../src/config/environment';
async function main() {
  const pool = new Pool({
    connectionString: validateEnvironment(process.env).DATABASE_URL,
    connectionTimeoutMillis: 8000,
  });
  try {
    await pool.query('SELECT 1');
    console.log('Connexion PostgreSQL vérifiée.');
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Connexion PostgreSQL impossible. Vérifiez votre configuration.');
  process.exitCode = 1;
});
