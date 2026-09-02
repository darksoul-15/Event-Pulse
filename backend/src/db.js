import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', () => {
  console.log('[DB] New PostgreSQL client connected');
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err);
});

// Test connection on startup
pool.query('SELECT NOW()').then(() => {
  console.log('[DB] ✅ PostgreSQL + pgvector connected successfully');
}).catch(err => {
  console.error('[DB] ❌ Connection failed:', err.message);
});

export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`[DB] Query OK (${duration}ms) → ${text.slice(0, 60)}...`);
    return res;
  } catch (err) {
    console.error('[DB] Query Error:', err.message, '\nQuery:', text);
    throw err;
  }
}

export default pool;
