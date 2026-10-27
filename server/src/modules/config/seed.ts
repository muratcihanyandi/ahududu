// app_config tohumlama — tablo boşsa varsayılan belgeyi yazar.
import type { Pool } from 'pg'
import { DEFAULT_CONFIG } from './defaults.ts'

export async function ensureDefaultConfig(pool: Pool): Promise<void> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM app_config`)
  if (rows[0].n === 0) {
    await pool.query(
      `INSERT INTO app_config (channel, version, content) VALUES ('stable', 1, $1)`,
      [JSON.stringify(DEFAULT_CONFIG)]
    )
  }
}

export async function getLatestConfig(
  pool: Pool
): Promise<{ version: number; content: unknown } | null> {
  const { rows } = await pool.query(
    `SELECT version, content FROM app_config WHERE channel = 'stable' ORDER BY version DESC LIMIT 1`
  )
  if (rows.length === 0) return null
  return { version: rows[0].version as number, content: rows[0].content }
}
