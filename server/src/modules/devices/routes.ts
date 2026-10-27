// Cihaz komutları — partnerin telefonunu/saatini titreştirme.
// Titreşim deseni sunucuda doğrulanır; hedef her zaman aynı alandaki diğer üyedir.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest, tooMany } from '../../lib/errors.ts'
import { newId } from '../../lib/tokens.ts'

const PATTERNS = new Set(['short', 'long', 'heartbeat', 'sos', 'kiss'])

// Aynı gönderici için desen başına bekleme (ms) — spam koruması.
const COOLDOWN_MS: Record<string, number> = {
  short: 5_000,
  long: 5_000,
  heartbeat: 10_000,
  sos: 15_000,
  kiss: 5_000,
}

interface BuzzRow {
  id: string
  sender_id: string
  sender_name: string
  target_id: string
  pattern: string
  note: string
  source: string
  created_at: Date
}

const SELECT_BUZZ = `
  SELECT b.*, u.display_name AS sender_name FROM device_buzzes b
    JOIN users u ON u.id = b.sender_id`

function mapBuzz(r: BuzzRow) {
  return {
    id: r.id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    targetId: r.target_id,
    pattern: r.pattern,
    note: r.note,
    source: r.source,
    createdAt: r.created_at,
  }
}

export async function registerDevicesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub, limiter } = ctx

  app.post('/api/v1/devices/buzz', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const pattern = typeof body?.pattern === 'string' ? body.pattern : 'short'
    if (!PATTERNS.has(pattern)) throw badRequest('Bilinmeyen titreşim deseni.')
    const note = typeof body?.note === 'string' ? body.note.slice(0, 120) : ''
    const source = body?.source === 'watch' ? 'watch' : 'phone'

    const cooldown = COOLDOWN_MS[pattern] ?? 5_000
    const rl = limiter(`buzz:${user.id}:${pattern}`, 1, cooldown)
    if (!rl.ok) {
      throw tooMany(`Çok sık titreşim gönderiyorsun. ${rl.retryAfterSec} saniye sonra tekrar dene.`, rl.retryAfterSec)
    }

    const { rows: partners } = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE space_id = $1 AND id <> $2 LIMIT 1',
      [user.spaceId, user.id]
    )
    if (partners.length === 0) throw badRequest('Alanında henüz başka üye yok.')

    const id = newId()
    await pool.query(
      `INSERT INTO device_buzzes (id, space_id, sender_id, target_id, pattern, note, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, user.spaceId, user.id, partners[0].id, pattern, note, source]
    )
    const { rows } = await pool.query<BuzzRow>(`${SELECT_BUZZ} WHERE b.id = $1`, [id])
    const buzz = mapBuzz(rows[0])
    await hub.publish(user.spaceId, 'device.buzz', buzz)
    return buzz
  })

  // Son titreşimler — kopma sonrası kaçırılanlar buradan okunur.
  app.get('/api/v1/devices/buzz', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { limit?: string }
    const limit = Math.min(Number(q.limit ?? 20) || 20, 50)
    const { rows } = await pool.query<BuzzRow>(
      `${SELECT_BUZZ} WHERE b.space_id = $1 AND b.target_id = $2
        ORDER BY b.created_at DESC LIMIT $3`,
      [user.spaceId, user.id, limit]
    )
    return { buzzes: rows.map(mapBuzz) }
  })
}
