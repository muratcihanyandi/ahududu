// Etkileşimler — ilgi isteme ve anlık romantik dokunuşlar; sunucu tarafı rate limit.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest, notFound, tooMany } from '../../lib/errors.ts'
import { newId } from '../../lib/tokens.ts'
import { DEFAULT_CONFIG } from '../config/defaults.ts'

interface InteractionRow {
  id: string
  sender_id: string
  sender_name: string
  kind: string
  payload: unknown
  status: string
  answered_at: Date | null
  created_at: Date
}

function mapInteraction(r: InteractionRow) {
  return {
    id: r.id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    kind: r.kind,
    payload: r.payload,
    status: r.status,
    answeredAt: r.answered_at,
    createdAt: r.created_at,
  }
}

const SELECT_INTERACTION = `
  SELECT i.*, u.display_name AS sender_name FROM interactions i
    JOIN users u ON u.id = i.sender_id`

export async function registerInteractionsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub, limiter } = ctx

  app.get('/api/v1/interactions/definitions', async (request) => {
    await requireAuth(pool, request)
    return { definitions: DEFAULT_CONFIG.interactions }
  })

  app.post('/api/v1/interactions', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const kind = typeof body?.kind === 'string' ? body.kind : ''
    const def = DEFAULT_CONFIG.interactions.find((d) => d.kind === kind)
    if (!def) throw badRequest('Bilinmeyen etkileşim türü.')

    const rl = limiter(`interaction:${user.id}:${kind}`, 1, def.cooldownSec * 1000)
    if (!rl.ok) {
      throw tooMany(
        `Bunu çok sık gönderiyorsun. ${rl.retryAfterSec} saniye sonra tekrar dene.`,
        rl.retryAfterSec
      )
    }

    const payload = typeof body?.payload === 'object' && body.payload !== null ? body.payload : null
    const id = newId()
    await pool.query(
      `INSERT INTO interactions (id, space_id, sender_id, kind, payload) VALUES ($1,$2,$3,$4,$5)`,
      [id, user.spaceId, user.id, kind, payload ? JSON.stringify(payload) : null]
    )
    const { rows } = await pool.query<InteractionRow>(`${SELECT_INTERACTION} WHERE i.id = $1`, [id])
    const interaction = mapInteraction(rows[0])
    await hub.publish(user.spaceId, 'interaction.new', {
      ...interaction,
      label: def.label,
      message: def.message,
      notify: def.notify,
    })
    return interaction
  })

  app.post('/api/v1/interactions/:id/answer', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const reply = typeof body?.reply === 'string' ? body.reply.slice(0, 200) : ''
    const { rows } = await pool.query(
      `UPDATE interactions SET status = 'answered', answered_at = now()
        WHERE id = $1 AND space_id = $2 AND sender_id <> $3 AND status = 'pending'
        RETURNING id, sender_id`,
      [id, user.spaceId, user.id]
    )
    if (rows.length === 0) throw notFound('Yanıtlanacak etkileşim bulunamadı.')
    await hub.publish(user.spaceId, 'interaction.answered', {
      id,
      byUserId: user.id,
      byName: user.displayName,
      reply,
    })
    return { ok: true }
  })

  app.get('/api/v1/interactions', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { limit?: string }
    const limit = Math.min(Number(q.limit ?? 30) || 30, 100)
    const { rows } = await pool.query<InteractionRow>(
      `${SELECT_INTERACTION} WHERE i.space_id = $1 ORDER BY i.created_at DESC LIMIT $2`,
      [user.spaceId, limit]
    )
    return { interactions: rows.map(mapInteraction) }
  })
}
