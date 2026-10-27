// Konum ve sağlık verileri — açıkça etkinleştirilen paylaşım, güncellik bilgisiyle.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest } from '../../lib/errors.ts'
import { newId } from '../../lib/tokens.ts'

export async function registerLocationHealthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub } = ctx

  app.put('/api/v1/location/status', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const sharing = body?.sharing
    if (sharing !== 'on' && sharing !== 'off' && sharing !== 'while_using') {
      throw badRequest('sharing değeri on, off veya while_using olmalı.')
    }
    const lat = Number(body?.lat)
    const lng = Number(body?.lng)
    const accuracy = Number(body?.accuracyM)
    const recordedAtRaw = typeof body?.recordedAt === 'string' ? body.recordedAt : null
    const recordedAt = recordedAtRaw && !Number.isNaN(new Date(recordedAtRaw).getTime())
      ? new Date(recordedAtRaw)
      : new Date()
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

    if (sharing === 'off') {
      // Paylaşım kapatıldığında koordinatlar silinir — eski konum "güncel" gibi görünmesin.
      await pool.query(
        `INSERT INTO location_status (user_id, sharing, lat, lng, accuracy_m, recorded_at, updated_at)
         VALUES ($1, 'off', NULL, NULL, NULL, NULL, now())
         ON CONFLICT (user_id) DO UPDATE
           SET sharing = 'off', lat = NULL, lng = NULL, accuracy_m = NULL,
               recorded_at = NULL, updated_at = now()`,
        [user.id]
      )
    } else {
      await pool.query(
        `INSERT INTO location_status (user_id, sharing, lat, lng, accuracy_m, recorded_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (user_id) DO UPDATE
           SET sharing = EXCLUDED.sharing, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
               accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at, updated_at = now()`,
        [user.id, sharing, hasCoords ? lat : null, hasCoords ? lng : null,
         Number.isFinite(accuracy) ? accuracy : null, hasCoords ? recordedAt : null]
      )
      if (hasCoords) {
        await pool.query(
          `INSERT INTO location_pings (id, user_id, lat, lng, accuracy_m, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId(), user.id, lat, lng, Number.isFinite(accuracy) ? accuracy : null, recordedAt]
        )
      }
    }
    await hub.publish(user.spaceId, 'location.updated', {
      userId: user.id,
      sharing,
      updatedAt: new Date().toISOString(),
    })
    return { ok: true, sharing }
  })

  app.get('/api/v1/location/partner', async (request) => {
    const user = await requireAuth(pool, request)
    const { rows } = await pool.query(
      `SELECT ls.user_id, u.display_name, ls.sharing, ls.lat, ls.lng, ls.accuracy_m, ls.recorded_at
         FROM location_status ls JOIN users u ON u.id = ls.user_id
        WHERE ls.user_id <> $1 AND u.space_id = $2`,
      [user.id, user.spaceId]
    )
    if (rows.length === 0) {
      return { partner: null, reason: 'partner_has_no_status' }
    }
    const r = rows[0]
    const ageSec = r.recorded_at ? Math.round((Date.now() - new Date(r.recorded_at).getTime()) / 1000) : null
    return {
      partner: {
        userId: r.user_id,
        displayName: r.display_name,
        sharing: r.sharing,
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy_m,
        recordedAt: r.recorded_at,
        // Güncellik istemcide yaşa göre gösterilir; sunucu ham veriyi verir.
        ageSeconds: ageSec,
        fresh: ageSec !== null && ageSec < 300,
      },
    }
  })

  app.post('/api/v1/health/samples', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const type = body?.type
    if (type !== 'heart_rate' && type !== 'steps' && type !== 'stress') {
      throw badRequest('type heart_rate, steps veya stress olmalı.')
    }
    const value = Number(body?.value)
    if (!Number.isFinite(value) || value < 0 || (type === 'stress' && value > 100) || value > 100_000) {
      throw badRequest('Geçersiz ölçüm değeri.')
    }
    const recordedAtRaw = typeof body?.recordedAt === 'string' ? body.recordedAt : null
    const recordedAt = recordedAtRaw && !Number.isNaN(new Date(recordedAtRaw).getTime())
      ? new Date(recordedAtRaw)
      : new Date()
    const unit = type === 'heart_rate' ? 'bpm' : type === 'stress' ? 'score' : 'count'
    const source = typeof body?.source === 'string' ? body.source.slice(0, 40) : 'unknown'

    if (type === 'steps') {
      // Günlük adım: aynı gün için en yüksek değer tutulur (çift sayım önlenir).
      const day = recordedAt.toISOString().slice(0, 10)
      await pool.query(
        `DELETE FROM health_samples
          WHERE user_id = $1 AND type = 'steps' AND recorded_at::date = $2::date`,
        [user.id, day]
      )
    }
    const id = newId()
    await pool.query(
      `INSERT INTO health_samples (id, user_id, type, value, unit, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, user.id, type, value, unit, recordedAt, source]
    )
    await hub.publish(user.spaceId, 'health.updated', { userId: user.id, type, value, recordedAt })
    return { ok: true, id }
  })

  app.get('/api/v1/health/partner', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { type?: string }
    const type = q.type === 'steps' ? 'steps' : q.type === 'stress' ? 'stress' : 'heart_rate'

    const { rows: partners } = await pool.query<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM users WHERE space_id = $1 AND id <> $2',
      [user.spaceId, user.id]
    )
    if (partners.length === 0) return { partner: null }

    const partner = partners[0]
    const { rows } = await pool.query<{ value: string; unit: string; recorded_at: Date; source: string }>(
      `SELECT value, unit, recorded_at, source FROM health_samples
        WHERE user_id = $1 AND type = $2 ORDER BY recorded_at DESC LIMIT 1`,
      [partner.id, type]
    )
    if (rows.length === 0) {
      return {
        partner: { userId: partner.id, displayName: partner.display_name, type, sample: null },
      }
    }
    const s = rows[0]
    const ageSec = Math.round((Date.now() - new Date(s.recorded_at).getTime()) / 1000)
    return {
      partner: {
        userId: partner.id,
        displayName: partner.display_name,
        type,
        sample: {
          value: Number(s.value),
          unit: s.unit,
          recordedAt: s.recorded_at,
          source: s.source,
          ageSeconds: ageSec,
          stale: ageSec > 600,
        },
      },
    }
  })

  app.get('/api/v1/health/me', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { type?: string }
    const type = q.type === 'steps' ? 'steps' : 'heart_rate'
    const { rows } = await pool.query(
      `SELECT value, unit, recorded_at, source FROM health_samples
        WHERE user_id = $1 AND type = $2 ORDER BY recorded_at DESC LIMIT 1`,
      [user.id, type]
    )
    return {
      sample: rows.length > 0
        ? { ...rows[0], value: Number(rows[0].value) }
        : null,
    }
  })
}
