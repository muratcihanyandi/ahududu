import pg from 'pg'
import type { Pool } from 'pg'

// Pi üzerindeki tek backend için küçük, sınırlı bir havuz yeterlidir.
export function createPool(databaseUrl: string): Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  pool.on('error', (err: Error) => {
    console.error('[db] boştaki istemci hatası:', err.message)
  })
  return pool
}
