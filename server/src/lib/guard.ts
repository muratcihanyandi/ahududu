// İstek başına kimlik doğrulama ve space üyeliği kontrolü.
// Kural: iki kullanıcılı sistem olsa da SUNUCU TARAFINDA yetki kontrolü her istekte yapılır.
import type { FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { unauthorized } from './errors.ts'
import { sha256 } from './tokens.ts'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  spaceId: string
  role: string
  sessionId: string
}

interface SessionRow {
  session_id: string
  id: string
  username: string
  display_name: string
  space_id: string
  role: string
}

export function bearerToken(request: FastifyRequest): string | null {
  const h = request.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  const t = h.slice(7).trim()
  return t.length > 0 ? t : null
}

export async function authenticateByToken(pool: Pool, token: string): Promise<AuthUser> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT s.id AS session_id, u.id, u.username, u.display_name, u.space_id, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN space_members m ON m.user_id = u.id AND m.space_id = u.space_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1`,
    [sha256(token)]
  )
  if (rows.length === 0) throw unauthorized('Oturum geçersiz veya süresi doldu')
  const r = rows[0]
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    spaceId: r.space_id,
    role: r.role,
    sessionId: r.session_id,
  }
}

export async function requireAuth(pool: Pool, request: FastifyRequest): Promise<AuthUser> {
  const token = bearerToken(request)
  if (!token) throw unauthorized()
  return authenticateByToken(pool, token)
}
