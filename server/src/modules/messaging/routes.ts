// Mesajlaşma modülü — gerçek zamanlı metin + medya eki, idempotent gönderim.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest, forbidden, notFound } from '../../lib/errors.ts'
import { newId } from '../../lib/tokens.ts'

interface MessageRow {
  id: string
  sender_id: string
  sender_name: string
  reply_to_id: string | null
  body: string
  client_msg_id: string
  created_at: Date
  edited_at: Date | null
  deleted_at: Date | null
  reactions: unknown
  attachments: unknown
  read_at: Date | null
}

function mapMessage(r: MessageRow, viewerId: string) {
  return {
    id: r.id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    mine: r.sender_id === viewerId,
    replyToId: r.reply_to_id,
    body: r.deleted_at ? '' : r.body,
    deleted: r.deleted_at !== null,
    clientMsgId: r.client_msg_id,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    reactions: r.reactions ?? [],
    attachments: r.attachments ?? [],
    readAt: r.read_at,
  }
}

const SELECT_MESSAGE = `
  SELECT m.id, m.sender_id, u.display_name AS sender_name, m.reply_to_id, m.body,
         m.client_msg_id, m.created_at, m.edited_at, m.deleted_at,
         COALESCE((
           SELECT json_agg(json_build_object('user_id', mr.user_id, 'reaction', mr.reaction))
             FROM message_reactions mr WHERE mr.message_id = m.id
         ), '[]'::json) AS reactions,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', ma.id, 'kind', ma.kind, 'mime', ma.mime,
             'width', ma.width, 'height', ma.height, 'durationMs', ma.duration_ms,
             'caption', ma.caption))
             FROM message_attachments mat JOIN media_assets ma ON ma.id = mat.media_id
            WHERE mat.message_id = m.id AND ma.deleted_at IS NULL
         ), '[]'::json) AS attachments,
         (SELECT max(r.read_at) FROM message_receipts r
           WHERE r.message_id = m.id AND r.user_id <> m.sender_id) AS read_at
    FROM messages m
    JOIN users u ON u.id = m.sender_id
`

export async function registerMessagingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub, limiter } = ctx

  app.get('/api/v1/messages', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { before?: string; limit?: string }
    const limit = Math.min(Number(q.limit ?? 50) || 50, 100)
    const before = q.before ? new Date(q.before) : null
    const params: unknown[] = [user.spaceId]
    let where = 'm.space_id = $1'
    if (before && !Number.isNaN(before.getTime())) {
      params.push(before)
      where += ` AND m.created_at < $${params.length}`
    }
    params.push(limit)
    const { rows } = await pool.query<MessageRow>(
      `${SELECT_MESSAGE} WHERE ${where} ORDER BY m.created_at DESC LIMIT $${params.length}`,
      params
    )
    return { messages: rows.map((r) => mapMessage(r, user.id)).reverse() }
  })

  // Idempotent gönderim: aynı clientMsgId ile tekrar istek → aynı mesaj döner.
  app.post('/api/v1/messages', async (request, reply) => {
    const user = await requireAuth(pool, request)
    const rl = limiter(`msg:${user.id}`, 60, 60_000)
    if (!rl.ok) {
      reply.header('retry-after', String(rl.retryAfterSec))
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Çok hızlı yazıyorsun, biraz bekle.' },
      })
    }
    const body = request.body as Record<string, unknown>
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    const clientMsgId = typeof body?.clientMsgId === 'string' ? body.clientMsgId : ''
    const replyToId = typeof body?.replyToId === 'string' ? body.replyToId : null
    const mediaIds = Array.isArray(body?.mediaIds) ? (body.mediaIds as string[]) : []
    if (!clientMsgId || clientMsgId.length > 80) throw badRequest('clientMsgId gerekli.')
    if (text.length === 0 && mediaIds.length === 0) throw badRequest('Boş mesaj gönderilemez.')
    if (text.length > 8000) throw badRequest('Mesaj çok uzun (en fazla 8000 karakter).')

    const existing = await pool.query<MessageRow>(
      `${SELECT_MESSAGE} WHERE m.sender_id = $1 AND m.client_msg_id = $2`,
      [user.id, clientMsgId]
    )
    if (existing.rows.length > 0) return mapMessage(existing.rows[0], user.id)

    if (replyToId) {
      const r = await pool.query('SELECT 1 FROM messages WHERE id = $1 AND space_id = $2', [
        replyToId,
        user.spaceId,
      ])
      if (r.rowCount === 0) throw notFound('Yanıtlanan mesaj bulunamadı.')
    }
    if (mediaIds.length > 0) {
      const r = await pool.query(
        `SELECT count(*)::int AS n FROM media_assets
          WHERE id = ANY($1::uuid[]) AND space_id = $2 AND deleted_at IS NULL`,
        [mediaIds, user.spaceId]
      )
      if (r.rows[0].n !== mediaIds.length) throw badRequest('Eklerden biri bulunamadı.')
    }

    const id = newId()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO messages (id, space_id, sender_id, reply_to_id, body, client_msg_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, user.spaceId, user.id, replyToId, text, clientMsgId]
      )
      for (const mediaId of mediaIds) {
        await client.query(
          `INSERT INTO message_attachments (message_id, media_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, mediaId]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const { rows } = await pool.query<MessageRow>(`${SELECT_MESSAGE} WHERE m.id = $1`, [id])
    const message = mapMessage(rows[0], user.id)
    await hub.publish(user.spaceId, 'message.new', message)
    return message
  })

  app.patch('/api/v1/messages/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text || text.length > 8000) throw badRequest('Geçerli bir mesaj gövdesi gerekli.')
    const { rows } = await pool.query(
      `UPDATE messages SET body = $1, edited_at = now()
        WHERE id = $2 AND space_id = $3 AND sender_id = $4 AND deleted_at IS NULL
        RETURNING id`,
      [text, id, user.spaceId, user.id]
    )
    if (rows.length === 0) throw forbidden('Yalnızca kendi mesajını düzenleyebilirsin.')
    const fresh = await pool.query<MessageRow>(`${SELECT_MESSAGE} WHERE m.id = $1`, [id])
    const message = mapMessage(fresh.rows[0], user.id)
    await hub.publish(user.spaceId, 'message.updated', message)
    return message
  })

  app.delete('/api/v1/messages/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rows } = await pool.query(
      `UPDATE messages SET deleted_at = now()
        WHERE id = $1 AND space_id = $2 AND sender_id = $3 AND deleted_at IS NULL
        RETURNING id`,
      [id, user.spaceId, user.id]
    )
    if (rows.length === 0) throw forbidden('Yalnızca kendi mesajını silebilirsin.')
    const fresh = await pool.query<MessageRow>(`${SELECT_MESSAGE} WHERE m.id = $1`, [id])
    const message = mapMessage(fresh.rows[0], user.id)
    await hub.publish(user.spaceId, 'message.updated', message)
    return message
  })

  app.post('/api/v1/messages/:id/reactions', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const reaction = typeof body?.reaction === 'string' ? body.reaction.slice(0, 16) : ''
    if (!reaction) throw badRequest('Tepki gerekli.')
    const check = await pool.query('SELECT 1 FROM messages WHERE id = $1 AND space_id = $2', [
      id,
      user.spaceId,
    ])
    if (check.rowCount === 0) throw notFound('Mesaj bulunamadı.')
    await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, reaction) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, user.id, reaction]
    )
    const fresh = await pool.query<MessageRow>(`${SELECT_MESSAGE} WHERE m.id = $1`, [id])
    const message = mapMessage(fresh.rows[0], user.id)
    await hub.publish(user.spaceId, 'message.updated', message)
    return message
  })

  app.delete('/api/v1/messages/:id/reactions/:reaction', async (request) => {
    const user = await requireAuth(pool, request)
    const { id, reaction } = request.params as { id: string; reaction: string }
    await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND reaction = $3', [
      id,
      user.id,
      reaction,
    ])
    const fresh = await pool.query<MessageRow>(`${SELECT_MESSAGE} WHERE m.id = $1`, [id])
    if (fresh.rows.length === 0) throw notFound('Mesaj bulunamadı.')
    const message = mapMessage(fresh.rows[0], user.id)
    await hub.publish(user.spaceId, 'message.updated', message)
    return message
  })

  // Okundu makbuzu — karşı tarafın mesajlarını okundu işaretler.
  app.post('/api/v1/messages/read', async (request) => {
    const user = await requireAuth(pool, request)
    const { rows } = await pool.query(
      `INSERT INTO message_receipts (message_id, user_id, read_at)
       SELECT id, $1, now() FROM messages
        WHERE space_id = $2 AND sender_id <> $1 AND deleted_at IS NULL
          AND created_at > now() - interval '30 days'
       ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now()
       RETURNING message_id`,
      [user.id, user.spaceId]
    )
    if (rows.length > 0) {
      await hub.publish(user.spaceId, 'messages.read', {
        byUserId: user.id,
        messageIds: rows.map((r: { message_id: string }) => r.message_id),
      })
    }
    return { marked: rows.length }
  })

  app.get('/api/v1/messages/unread', async (request) => {
    const user = await requireAuth(pool, request)
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM messages m
        WHERE m.space_id = $1 AND m.sender_id <> $2 AND m.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM message_receipts r
                           WHERE r.message_id = m.id AND r.user_id = $2)`,
      [user.spaceId, user.id]
    )
    return { unread: rows[0].n }
  })
}
