// Auth modülü — kurulum, davetle katılma, giriş, oturum ve uzay bilgileri.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest, conflict, notFound, tooMany, unauthorized } from '../../lib/errors.ts'
import {
  hashPassword,
  verifyPassword,
  newToken,
  newInviteCode,
  isValidInviteCode,
  newId,
  sha256,
} from '../../lib/tokens.ts'
import { clientIp } from '../../lib/rate-limit.ts'

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function validateProfile(username: unknown, displayName: unknown, password: unknown): {
  username: string
  displayName: string
  password: string
} {
  const u = str(username)
  const d = str(displayName)
  const p = str(password)
  if (!u || !USERNAME_RE.test(u)) {
    throw badRequest('Kullanıcı adı 3-30 karakter olmalı; küçük harf, rakam, nokta ve alt çizgi içerebilir.')
  }
  if (!d || d.trim().length < 1 || d.trim().length > 40) {
    throw badRequest('Görünen ad 1-40 karakter olmalı.')
  }
  if (!p || p.length < 6) {
    throw badRequest('Parola en az 6 karakter olmalı.')
  }
  return { username: u, displayName: d.trim(), password: p }
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, config: cfg, limiter, hub } = ctx

  // İlk kurulum: alanı, sahip kullanıcıyı, daveti ve oturumu birlikte oluşturur.
  app.post('/api/v1/auth/setup', async (request) => {
    const rl = limiter(`setup:${clientIp(request)}`, 10, 60 * 60 * 1000)
    if (!rl.ok) throw tooMany('Çok fazla deneme yapıldı, lütfen bir süre bekle.', rl.retryAfterSec)

    const body = request.body as Record<string, unknown>
    const spaceName = str(body?.spaceName)?.trim() ?? ''
    if (spaceName.length < 1 || spaceName.length > 60) throw badRequest('Alan adı 1-60 karakter olmalı.')
    const profile = validateProfile(body?.username, body?.displayName, body?.password)

    const { rows: existing } = await pool.query('SELECT count(*)::int AS n FROM users')
    if (existing[0].n > 0) {
      throw conflict('Sistem zaten kurulmuş. Giriş yapabilir veya davet koduyla katılabilirsin.')
    }

    const spaceId = newId()
    const userId = newId()
    const code = newInviteCode()
    const inviteExpiry = new Date(Date.now() + cfg.inviteTtlDays * 86_400_000)
    const { token, tokenHash } = newToken()
    const tokenExpiry = new Date(Date.now() + cfg.tokenTtlDays * 86_400_000)
    const { hash, salt } = await hashPassword(profile.password)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Aynı anda iki kurulum isteğinin yarışını önle.
      await client.query('SELECT pg_advisory_xact_lock(918273645)')
      await client.query('INSERT INTO spaces (id, name) VALUES ($1, $2)', [spaceId, spaceName])
      await client.query(
        `INSERT INTO users (id, space_id, username, display_name, password_hash, password_salt)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, spaceId, profile.username, profile.displayName, hash, salt]
      )
      await client.query(
        `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [spaceId, userId]
      )
      await client.query(
        `INSERT INTO invites (id, space_id, code_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId(), spaceId, sha256(code), userId, inviteExpiry]
      )
      await client.query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        [newId(), userId, tokenHash, tokenExpiry]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return {
      token,
      expiresAt: tokenExpiry.toISOString(),
      user: { id: userId, username: profile.username, displayName: profile.displayName },
      space: { id: spaceId, name: spaceName },
      invite: { code, expiresAt: inviteExpiry.toISOString() },
    }
  })

  // Davet koduyla ikinci kullanıcı katılımı.
  app.post('/api/v1/auth/join', async (request) => {
    const rl = limiter(`join:${clientIp(request)}`, 20, 60 * 60 * 1000)
    if (!rl.ok) throw tooMany('Çok fazla deneme yapıldı, lütfen bir süre bekle.', rl.retryAfterSec)

    const body = request.body as Record<string, unknown>
    const code = str(body?.inviteCode)?.trim().toUpperCase() ?? ''
    if (!isValidInviteCode(code)) throw badRequest('Davet kodu 8 karakter olmalı (ör. AH7K2M9P).')
    const profile = validateProfile(body?.username, body?.displayName, body?.password)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: invites } = await client.query(
        `SELECT id, space_id FROM invites
          WHERE code_hash = $1 AND used_by IS NULL AND expires_at > now()
          FOR UPDATE`,
        [sha256(code)]
      )
      if (invites.length === 0) {
        throw notFound('Davet kodu geçersiz, kullanılmış veya süresi dolmuş.')
      }
      const invite = invites[0]
      const { rows: countRows } = await client.query(
        'SELECT count(*)::int AS n FROM space_members WHERE space_id = $1',
        [invite.space_id]
      )
      if (countRows[0].n >= 2) throw conflict('Bu alan dolu — Ahududu iki kişi içindir.')

      const userId = newId()
      const { hash, salt } = await hashPassword(profile.password)
      const { token, tokenHash } = newToken()
      const tokenExpiry = new Date(Date.now() + cfg.tokenTtlDays * 86_400_000)

      await client.query(
        `INSERT INTO users (id, space_id, username, display_name, password_hash, password_salt)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, invite.space_id, profile.username, profile.displayName, hash, salt]
      )
      await client.query(
        `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'member')`,
        [invite.space_id, userId]
      )
      await client.query('UPDATE invites SET used_by = $1, used_at = now() WHERE id = $2', [
        userId,
        invite.id,
      ])
      await client.query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        [newId(), userId, tokenHash, tokenExpiry]
      )
      await client.query('COMMIT')

      const { rows: spaceRows } = await pool.query('SELECT name FROM spaces WHERE id = $1', [
        invite.space_id,
      ])
      await hub.publish(invite.space_id, 'space.member_joined', {
        userId,
        displayName: profile.displayName,
      })
      return {
        token,
        expiresAt: tokenExpiry.toISOString(),
        user: { id: userId, username: profile.username, displayName: profile.displayName },
        space: { id: invite.space_id, name: spaceRows[0].name },
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Parola ile giriş; istenirse cihaz kaydı oluşturulur.
  app.post('/api/v1/auth/login', async (request) => {
    const body = request.body as Record<string, unknown>
    const username = str(body?.username)?.toLowerCase() ?? ''
    const password = str(body?.password) ?? ''
    const deviceName = str(body?.deviceName)?.trim()
    const platform = str(body?.platform) === 'wear' ? 'wear' : 'android'

    const rl = limiter(`login:${clientIp(request)}:${username}`, 15, 10 * 60 * 1000)
    if (!rl.ok) throw tooMany('Çok fazla hatalı deneme. Bir süre sonra tekrar dene.', rl.retryAfterSec)

    if (!username || !password) throw badRequest('Kullanıcı adı ve parola gerekli.')
    const { rows } = await pool.query(
      'SELECT id, space_id, display_name, password_hash, password_salt FROM users WHERE username = $1',
      [username]
    )
    if (rows.length === 0) throw unauthorized('Kullanıcı adı veya parola hatalı.')
    const user = rows[0]
    const ok = await verifyPassword(password, user.password_salt, user.password_hash)
    if (!ok) throw unauthorized('Kullanıcı adı veya parola hatalı.')

    let deviceId: string | null = null
    if (deviceName && deviceName.length <= 60) {
      deviceId = newId()
      await pool.query(
        `INSERT INTO devices (id, user_id, name, platform) VALUES ($1, $2, $3, $4)`,
        [deviceId, user.id, deviceName, platform]
      )
    }
    const { token, tokenHash } = newToken()
    const tokenExpiry = new Date(Date.now() + cfg.tokenTtlDays * 86_400_000)
    await pool.query(
      `INSERT INTO sessions (id, user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [newId(), user.id, deviceId, tokenHash, tokenExpiry]
    )
    await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id])

    const { rows: spaceRows } = await pool.query('SELECT id, name FROM spaces WHERE id = $1', [
      user.space_id,
    ])
    return {
      token,
      expiresAt: tokenExpiry.toISOString(),
      user: { id: user.id, username, displayName: user.display_name },
      space: { id: spaceRows[0].id, name: spaceRows[0].name },
    }
  })

  app.post('/api/v1/auth/logout', async (request) => {
    const user = await requireAuth(pool, request)
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [user.sessionId])
    return { ok: true }
  })

  app.get('/api/v1/me', async (request) => {
    const user = await requireAuth(pool, request)
    const { rows: members } = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.last_seen_at
         FROM space_members m JOIN users u ON u.id = m.user_id
        WHERE m.space_id = $1 ORDER BY m.joined_at`,
      [user.spaceId]
    )
    const { rows: devices } = await pool.query(
      `SELECT id, name, platform, model, last_active_at FROM devices WHERE user_id = $1 ORDER BY created_at`,
      [user.id]
    )
    const { rows: spaceRows } = await pool.query('SELECT id, name FROM spaces WHERE id = $1', [
      user.spaceId,
    ])
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName },
      space: { id: spaceRows[0].id, name: spaceRows[0].name },
      members: members.map((m: { id: string; username: string; display_name: string; last_seen_at: string | null }) => ({
        id: m.id,
        username: m.username,
        displayName: m.display_name,
        lastSeenAt: m.last_seen_at,
      })),
      devices: devices.map((d: { id: string; name: string; platform: string; model: string | null; last_active_at: string | null }) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        model: d.model,
        lastActiveAt: d.last_active_at,
      })),
    }
  })

  app.patch('/api/v1/me', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const displayName = str(body?.displayName)?.trim()
    if (!displayName || displayName.length < 1 || displayName.length > 40) {
      throw badRequest('Görünen ad 1-40 karakter olmalı.')
    }
    await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [displayName, user.id])
    return { ok: true, displayName }
  })

  app.get('/api/v1/space', async (request) => {
    const user = await requireAuth(pool, request)
    const { rows: spaceRows } = await pool.query('SELECT id, name, created_at FROM spaces WHERE id = $1', [
      user.spaceId,
    ])
    const { rows: members } = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.last_seen_at
         FROM space_members m JOIN users u ON u.id = m.user_id
        WHERE m.space_id = $1 ORDER BY m.joined_at`,
      [user.spaceId]
    )
    const { rows: invites } = await pool.query(
      `SELECT expires_at FROM invites
        WHERE space_id = $1 AND used_by IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [user.spaceId]
    )
    return {
      space: { id: spaceRows[0].id, name: spaceRows[0].name, createdAt: spaceRows[0].created_at },
      members: members.map((m: { id: string; username: string; display_name: string; last_seen_at: string | null }) => ({
        id: m.id,
        username: m.username,
        displayName: m.display_name,
        lastSeenAt: m.last_seen_at,
      })),
      invite: {
        active: invites.length > 0,
        expiresAt: invites.length > 0 ? invites[0].expires_at : null,
      },
    }
  })

  // Yeni davet kodu — yalnızca alan sahibi; eski aktif kod devre dışı kalır.
  app.post('/api/v1/space/invite', async (request) => {
    const user = await requireAuth(pool, request)
    if (user.role !== 'owner') throw conflict('Davet kodunu yalnızca alan sahibi oluşturabilir.')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE invites SET expires_at = now()
          WHERE space_id = $1 AND used_by IS NULL AND expires_at > now()`,
        [user.spaceId]
      )
      const code = newInviteCode()
      const expiry = new Date(Date.now() + cfg.inviteTtlDays * 86_400_000)
      await client.query(
        `INSERT INTO invites (id, space_id, code_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId(), user.spaceId, sha256(code), user.id, expiry]
      )
      await client.query('COMMIT')
      return { code, expiresAt: expiry.toISOString() }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  app.delete('/api/v1/space/invite', async (request) => {
    const user = await requireAuth(pool, request)
    if (user.role !== 'owner') throw conflict('Bu işlemi yalnızca alan sahibi yapabilir.')
    await pool.query(
      `UPDATE invites SET expires_at = now()
        WHERE space_id = $1 AND used_by IS NULL AND expires_at > now()`,
      [user.spaceId]
    )
    return { ok: true }
  })
}
