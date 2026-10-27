// Mektuplar — taslak otomatik kaydı, vektörel çizim sayfaları, gönderme ve favoriler.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest, forbidden, notFound } from '../../lib/errors.ts'
import { newId } from '../../lib/tokens.ts'

interface LetterRow {
  id: string
  author_id: string
  author_name: string
  title: string
  paper_style: string
  envelope_style: string
  status: string
  body_md: string
  client_draft_id: string | null
  sent_at: Date | null
  first_read_at: Date | null
  created_at: Date
  updated_at: Date
  favorite: boolean
  page_count: number
}

function mapLetter(r: LetterRow, viewerId: string) {
  return {
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name,
    mine: r.author_id === viewerId,
    title: r.title,
    paperStyle: r.paper_style,
    envelopeStyle: r.envelope_style,
    status: r.status,
    bodyMd: r.body_md,
    sentAt: r.sent_at,
    firstReadAt: r.first_read_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    favorite: r.favorite,
    pageCount: r.page_count,
  }
}

const SELECT_LETTER = `
  SELECT l.*, u.display_name AS author_name,
         EXISTS (SELECT 1 FROM letter_favorites f WHERE f.letter_id = l.id) AS favorite,
         (SELECT count(*)::int FROM letter_pages p WHERE p.letter_id = l.id) AS page_count
    FROM letters l JOIN users u ON u.id = l.author_id`

// Vektörel stroke doğrulaması — bozuk çizim verisi DB'ye girmesin.
interface Stroke {
  tool: 'pen' | 'highlighter' | 'eraser'
  color: string
  width: number
  points: Array<[number, number, number]>
}

export function validateStrokes(strokes: unknown): Stroke[] {
  if (!Array.isArray(strokes)) return []
  if (strokes.length > 5000) throw badRequest('Bir sayfada en fazla 5000 çizgi olabilir.')
  const out: Stroke[] = []
  for (const s of strokes) {
    if (typeof s !== 'object' || s === null) continue
    const raw = s as Record<string, unknown>
    const tool = raw.tool
    if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'eraser') continue
    const color = typeof raw.color === 'string' && /^#[0-9A-Fa-f]{6,8}$/.test(raw.color) ? raw.color : '#3E2B31'
    const width = Number(raw.width)
    if (!Number.isFinite(width) || width < 0.5 || width > 60) continue
    const pts: Array<[number, number, number]> = []
    if (Array.isArray(raw.points)) {
      for (const p of raw.points) {
        if (!Array.isArray(p) || p.length < 2) continue
        const x = Number(p[0])
        const y = Number(p[1])
        const pressure = p.length > 2 ? Number(p[2]) : 1
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (x < -10 || x > 10010 || y < -10 || y > 10010) continue
        pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.min(1, Math.max(0, pressure || 1))])
      }
    }
    if (pts.length === 0) continue
    out.push({ tool, color, width, points: pts })
  }
  return out
}

export async function registerLettersRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub } = ctx

  app.get('/api/v1/letters', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { box?: string; favorite?: string }
    const params: unknown[] = [user.spaceId]
    let where = 'l.space_id = $1 AND l.deleted_at IS NULL'
    if (q.box === 'inbox') {
      where += ` AND l.author_id <> $2 AND l.status <> 'draft'`
      params.push(user.id)
    } else if (q.box === 'sent') {
      where += ` AND l.author_id = $2 AND l.status <> 'draft'`
      params.push(user.id)
    } else if (q.box === 'drafts') {
      where += ` AND l.author_id = $2 AND l.status = 'draft'`
      params.push(user.id)
    } else {
      // Karşı tarafın taslakları asla görünmez.
      where += ` AND (l.author_id = $2 OR l.status <> 'draft')`
      params.push(user.id)
    }
    if (q.favorite === '1') where += ' AND EXISTS (SELECT 1 FROM letter_favorites f WHERE f.letter_id = l.id)'
    const { rows } = await pool.query<LetterRow>(
      `${SELECT_LETTER} WHERE ${where} ORDER BY l.updated_at DESC LIMIT 200`,
      params
    )
    return { letters: rows.map((r) => mapLetter(r, user.id)) }
  })

  // Taslak upsert — clientDraftId ile idempotent (uygulama kapansa da taslak kaybolmaz).
  app.post('/api/v1/letters', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const clientDraftId = typeof body?.clientDraftId === 'string' ? body.clientDraftId : newId()
    const title = typeof body?.title === 'string' ? body.title.slice(0, 200) : ''
    const bodyMd = typeof body?.bodyMd === 'string' ? body.bodyMd : ''
    const paperStyle = validStyle(body?.paperStyle, ['klasik', 'cizgili', 'minimal', 'ozelgun'], 'klasik')
    const envelopeStyle = validStyle(body?.envelopeStyle, ['klasik', 'muhur'], 'klasik')

    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM letters WHERE author_id = $1 AND client_draft_id = $2',
      [user.id, clientDraftId]
    )
    let id: string
    if (existing.rows.length > 0) {
      id = existing.rows[0].id
      await pool.query(
        `UPDATE letters SET title=$1, body_md=$2, paper_style=$3, envelope_style=$4, updated_at=now()
          WHERE id = $5 AND status = 'draft'`,
        [title, bodyMd, paperStyle, envelopeStyle, id]
      )
    } else {
      id = newId()
      await pool.query(
        `INSERT INTO letters (id, space_id, author_id, title, body_md, paper_style, envelope_style, client_draft_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, user.spaceId, user.id, title, bodyMd, paperStyle, envelopeStyle, clientDraftId]
      )
    }
    const { rows } = await pool.query<LetterRow>(`${SELECT_LETTER} WHERE l.id = $1`, [id])
    return mapLetter(rows[0], user.id)
  })

  app.get('/api/v1/letters/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rows } = await pool.query<LetterRow>(
      `${SELECT_LETTER} WHERE l.id = $1 AND l.space_id = $2 AND l.deleted_at IS NULL`,
      [id, user.spaceId]
    )
    if (rows.length === 0) throw notFound('Mektup bulunamadı.')
    const letter = rows[0]
    if (letter.status === 'draft' && letter.author_id !== user.id) {
      throw forbidden('Bu mektup henüz gönderilmedi.')
    }
    const pages = await pool.query(
      `SELECT page_no, background, strokes, updated_at FROM letter_pages
        WHERE letter_id = $1 ORDER BY page_no`,
      [id]
    )
    return {
      ...mapLetter(letter, user.id),
      pages: pages.rows.map((p: { page_no: number; background: string; strokes: unknown; updated_at: Date }) => ({
        pageNo: p.page_no,
        background: p.background,
        strokes: p.strokes ?? [],
        updatedAt: p.updated_at,
      })),
    }
  })

  app.patch('/api/v1/letters/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const { rows: owned } = await pool.query<{ status: string }>(
      'SELECT status FROM letters WHERE id = $1 AND space_id = $2 AND author_id = $3 AND deleted_at IS NULL',
      [id, user.spaceId, user.id]
    )
    if (owned.length === 0) throw forbidden('Yalnızca kendi mektubunu düzenleyebilirsin.')
    if (owned[0].status !== 'draft') throw badRequest('Gönderilmiş mektup düzenlenemez.')

    const title = typeof body?.title === 'string' ? body.title.slice(0, 200) : undefined
    const bodyMd = typeof body?.bodyMd === 'string' ? body.bodyMd : undefined
    const paperStyle = body?.paperStyle ? validStyle(body.paperStyle, ['klasik', 'cizgili', 'minimal', 'ozelgun'], 'klasik') : undefined
    const envelopeStyle = body?.envelopeStyle ? validStyle(body.envelopeStyle, ['klasik', 'muhur'], 'klasik') : undefined

    await pool.query(
      `UPDATE letters SET
         title = COALESCE($1, title),
         body_md = COALESCE($2, body_md),
         paper_style = COALESCE($3, paper_style),
         envelope_style = COALESCE($4, envelope_style),
         updated_at = now()
       WHERE id = $5`,
      [title ?? null, bodyMd ?? null, paperStyle ?? null, envelopeStyle ?? null, id]
    )

    // Sayfa güncellemesi: yalnızca gönderilen sayfalar değişir.
    if (Array.isArray(body?.pages)) {
      for (const raw of body.pages) {
        if (typeof raw !== 'object' || raw === null) continue
        const p = raw as Record<string, unknown>
        const pageNo = Number(p.pageNo)
        if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 50) continue
        const background = validStyle(p.background, ['plain', 'lined', 'dotted', 'grid'], 'plain')
        const strokes = validateStrokes(p.strokes)
        await pool.query(
          `INSERT INTO letter_pages (letter_id, page_no, background, strokes, updated_at)
           VALUES ($1,$2,$3,$4, now())
           ON CONFLICT (letter_id, page_no)
           DO UPDATE SET background = EXCLUDED.background, strokes = EXCLUDED.strokes, updated_at = now()`,
          [id, pageNo, background, JSON.stringify(strokes)]
        )
      }
    }

    const { rows } = await pool.query<LetterRow>(`${SELECT_LETTER} WHERE l.id = $1`, [id])
    return mapLetter(rows[0], user.id)
  })

  app.post('/api/v1/letters/:id/send', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rows } = await pool.query<{ title: string; body_md: string }>(
      `UPDATE letters SET status = 'sent', sent_at = now(), updated_at = now()
        WHERE id = $1 AND space_id = $2 AND author_id = $3 AND status = 'draft' AND deleted_at IS NULL
        RETURNING title, body_md`,
      [id, user.spaceId, user.id]
    )
    if (rows.length === 0) throw badRequest('Gönderilecek taslak bulunamadı (belki zaten gönderildi).')
    if (rows[0].title.trim().length === 0 && rows[0].body_md.trim().length === 0) {
      throw badRequest('Boş mektup gönderilemez — bir başlık veya metin yaz.')
    }
    const fresh = await pool.query<LetterRow>(`${SELECT_LETTER} WHERE l.id = $1`, [id])
    const letter = mapLetter(fresh.rows[0], user.id)
    await hub.publish(user.spaceId, 'letter.new', letter)
    return letter
  })

  app.post('/api/v1/letters/:id/read', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rows } = await pool.query<{ author_id: string; first_read_at: Date | null }>(
      'SELECT author_id, first_read_at FROM letters WHERE id = $1 AND space_id = $2',
      [id, user.spaceId]
    )
    if (rows.length === 0) throw notFound('Mektup bulunamadı.')
    if (rows[0].author_id === user.id) return { ok: true, alreadyRead: true }
    if (rows[0].first_read_at === null) {
      await pool.query(
        `UPDATE letters SET first_read_at = now(), status = 'read'
          WHERE id = $1 AND first_read_at IS NULL`,
        [id]
      )
      await hub.publish(user.spaceId, 'letter.read', { id, byUserId: user.id })
    }
    return { ok: true }
  })

  app.post('/api/v1/letters/:id/favorite', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const check = await pool.query('SELECT 1 FROM letters WHERE id = $1 AND space_id = $2', [id, user.spaceId])
    if (check.rowCount === 0) throw notFound('Mektup bulunamadı.')
    await pool.query(
      `INSERT INTO letter_favorites (letter_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, user.id]
    )
    return { ok: true, favorite: true }
  })

  app.delete('/api/v1/letters/:id/favorite', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    await pool.query('DELETE FROM letter_favorites WHERE letter_id = $1 AND user_id = $2', [id, user.id])
    return { ok: true, favorite: false }
  })

  app.delete('/api/v1/letters/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rowCount } = await pool.query(
      'UPDATE letters SET deleted_at = now() WHERE id = $1 AND space_id = $2 AND author_id = $3',
      [id, user.spaceId, user.id]
    )
    if (rowCount === 0) throw notFound('Mektup bulunamadı.')
    return { ok: true }
  })
}

function validStyle(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}
