// Basit, bağımlılıksız SQL migration koşucusu.
// Kural: server/migrations/NNN_adi.sql — dosyanın üst kısmı 'up',
// '-- +Down' satırından sonrası geri alma adımıdır.
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { Pool } from 'pg'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

export function splitMigration(sql: string): { up: string; down: string | null } {
  const m = sql.match(/^--\s*\+Down\b.*$/m)
  if (!m || m.index === undefined) return { up: sql, down: null }
  return { up: sql.slice(0, m.index), down: sql.slice(m.index + m[0].length) }
}

export async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR)
  return entries.filter((f) => f.endsWith('.sql')).sort()
}

async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
}

async function appliedSet(pool: Pool): Promise<Map<string, string>> {
  const { rows } = await pool.query('SELECT name, checksum FROM schema_migrations')
  return new Map(rows.map((r: { name: string; checksum: string }) => [r.name, r.checksum]))
}

export async function migrateUp(pool: Pool): Promise<string[]> {
  await ensureTable(pool)
  const applied = await appliedSet(pool)
  const files = await listMigrationFiles()
  const newlyApplied: string[] = []
  for (const name of files) {
    if (applied.has(name)) continue
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
    const { up } = splitMigration(sql)
    const checksum = simpleChecksum(sql)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(up)
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum])
      await client.query('COMMIT')
      newlyApplied.push(name)
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`Migration başarısız (${name}): ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }
  return newlyApplied
}

export async function migrateDown(pool: Pool): Promise<string> {
  await ensureTable(pool)
  const { rows } = await pool.query(
    'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1'
  )
  if (rows.length === 0) throw new Error('Geri alınacak migration yok')
  const name = rows[0].name as string
  const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
  const { down } = splitMigration(sql)
  if (!down) throw new Error(`${name} geri alma bloğu içermiyor`)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(down)
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [name])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw new Error(`Geri alma başarısız (${name}): ${(err as Error).message}`)
  } finally {
    client.release()
  }
  return name
}

function simpleChecksum(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

// CLI: npm run db:migrate / db:rollback
const isCli =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isCli) {
  const direction = process.argv[2] ?? 'up'
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL ortam değişkeni gerekli.')
    process.exit(1)
  }
  const pool = createPoolLocal(databaseUrl)
  try {
    if (direction === 'up') {
      const applied = await migrateUp(pool)
      console.log(applied.length ? `Uygulanan migration'lar: ${applied.join(', ')}` : 'Yeni migration yok')
    } else if (direction === 'down') {
      const name = await migrateDown(pool)
      console.log(`Geri alındı: ${name}`)
    } else {
      console.error('Kullanım: migrate.ts [up|down]')
      process.exit(1)
    }
  } finally {
    await pool.end()
  }
}

function createPoolLocal(databaseUrl: string): Pool {
  // Dairesel içe aktarmayı önlemek için yerel havuz oluştur.
  return new pg.Pool({ connectionString: databaseUrl, max: 2 })
}
