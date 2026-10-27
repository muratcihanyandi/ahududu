// WS uç noktası (/ws?token=...) ve olay yakalama REST ucu.
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { authenticateByToken } from '../../lib/guard.ts'
import { badRequest } from '../../lib/errors.ts'
import { requireAuth } from '../../lib/guard.ts'

export async function registerEventsModule(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub } = ctx
  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket, request) => {
    const token = (request.query as { token?: string }).token
    void (async () => {
      let user
      try {
        if (!token) throw new Error('token gerekli')
        user = await authenticateByToken(pool, token)
      } catch {
        socket.send(JSON.stringify({ type: 'error', payload: { code: 'unauthorized' }, seq: null, serverTs: new Date().toISOString() }))
        socket.close(4001, 'unauthorized')
        return
      }
      hub.add(user.spaceId, socket, user.id)
      hub.broadcastPresence(user.spaceId)
      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(String(raw)) as { type?: string; payload?: unknown }
          if (msg?.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', payload: null, seq: null, serverTs: new Date().toISOString() }))
          } else if (msg?.type && msg.type.startsWith('audio.')) {
            // Canlı ses akışı ve sinyalleri (ortam dinleme / walkie-talkie)
            hub.forwardEphemeral(
              user.spaceId,
              msg.type,
              {
                fromUserId: user.id,
                ...(typeof msg.payload === 'object' && msg.payload ? msg.payload : {}),
              },
              user.id
            )
          }
        } catch {
          // Bozuk istemci mesajları sessizce yok sayılır.
        }
      })
      socket.on('close', () => {
        hub.remove(user.spaceId, socket)
        hub.broadcastPresence(user.spaceId)
      })
      socket.on('error', () => {
        hub.remove(user.spaceId, socket)
      })
    })()
  })

  // Bağlantı koptuğunda kaçırılan olayları seq ile yakala.
  app.get('/api/v1/events', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { since?: string }
    const since = Number(q.since ?? 0)
    if (!Number.isFinite(since) || since < 0) throw badRequest('since sayısal ve negatif olmayan olmalı.')
    const { rows } = await pool.query(
      `SELECT seq, type, payload, created_at FROM events
        WHERE space_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 200`,
      [user.spaceId, since]
    )
    return {
      events: rows.map(
        (r: { seq: string | number; type: string; payload: unknown; created_at: string }) => ({
          seq: Number(r.seq),
          type: r.type,
          payload: r.payload,
          createdAt: r.created_at,
        })
      ),
    }
  })
}
