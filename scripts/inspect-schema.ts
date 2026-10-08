import 'dotenv/config';
import { Pool } from 'pg';
async function inspect() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  try {
    const result = await pool.query(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','gainde_v1') ORDER BY table_schema,table_name",
    );
    console.log(JSON.stringify(result.rows));
  } finally {
    await pool.end();
  }
}
inspect().catch(() => {
  console.error('Inspection de schéma impossible. Aucun secret affiché.');
  process.exitCode = 1;
});
