// Ortak notlar — iyimser sürümleme; çakışmada sessiz üzerine yazma YOK.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest, notFound } from '../../lib/errors.ts'
import { newId } from '../../lib/tokens.ts'

interface NoteRow {
  id: string
  title: string
  body: string
  color: string
  pinned: boolean
  done: boolean
  checklist: unknown
  version: number
  created_at: Date
  updated_at: Date
  created_by: string
  editor_name: string | null
}

function mapNote(r: NoteRow) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    color: r.color,
    pinned: r.pinned,
    done: r.done,
    checklist: r.checklist ?? [],
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    editorName: r.editor_name,
  }
}

const SELECT_NOTE = `
  SELECT n.*, (SELECT u.display_name FROM users u WHERE u.id = n.created_by) AS editor_name
    FROM notes n`

export async function registerNotesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub } = ctx

  app.get('/api/v1/notes', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { q?: string; pinned?: string }
    const params: unknown[] = [user.spaceId]
    let where = 'n.space_id = $1 AND n.deleted_at IS NULL'
    if (q.pinned === '1') where += ' AND n.pinned = true'
    if (q.q && q.q.trim().length > 0) {
      params.push(`%${q.q.trim()}%`)
      where += ` AND (n.title ILIKE $${params.length} OR n.body ILIKE $${params.length})`
    }
    const { rows } = await pool.query<NoteRow>(
      `${SELECT_NOTE} WHERE ${where} ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 200`,
      params
    )
    return { notes: rows.map(mapNote) }
  })

  app.get('/api/v1/notes/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rows } = await pool.query<NoteRow>(
      `${SELECT_NOTE} WHERE n.id = $1 AND n.space_id = $2 AND n.deleted_at IS NULL`,
      [id, user.spaceId]
    )
    if (rows.length === 0) throw notFound('Not bulunamadı.')
    return mapNote(rows[0])
  })

  app.post('/api/v1/notes', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : ''
    const text = typeof body?.body === 'string' ? body.body : ''
    const color = typeof body?.color === 'string' ? body.color.slice(0, 24) : 'krem'
    const checklist = Array.isArray(body?.checklist) ? body.checklist : []
    if (title.length === 0 && text.trim().length === 0 && checklist.length === 0) {
      throw badRequest('Boş not oluşturulamaz.')
    }
    const id = newId()
    await pool.query(
      `INSERT INTO notes (id, space_id, created_by, title, body, color, checklist)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, user.spaceId, user.id, title, text, color, JSON.stringify(checklist)]
    )
    const { rows } = await pool.query<NoteRow>(`${SELECT_NOTE} WHERE n.id = $1`, [id])
    const note = mapNote(rows[0])
    await hub.publish(user.spaceId, 'note.updated', note)
    return note
  })

  // baseVersion zorunlu: iki kişi aynı anda düzenlerse 409 + güncel belge döner.
  app.patch('/api/v1/notes/:id', async (request, reply) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const baseVersion = Number(body?.baseVersion)
    if (!Number.isFinite(baseVersion)) throw badRequest('baseVersion gerekli (çakışma koruması).')

    const current = await pool.query<NoteRow>(
      `${SELECT_NOTE} WHERE n.id = $1 AND n.space_id = $2 AND n.deleted_at IS NULL`,
      [id, user.spaceId]
    )
    if (current.rows.length === 0) throw notFound('Not bulunamadı.')
    const note = current.rows[0]
    if (note.version !== baseVersion) {
      return reply.status(409).send({
        error: {
          code: 'version_conflict',
          message: 'Bu not başka bir cihazda değiştirildi. Güncel hali aşağıda.',
        },
        current: mapNote(note),
      })
    }

    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : note.title
    const text = typeof body?.body === 'string' ? body.body : note.body
    const color = typeof body?.color === 'string' ? body.color.slice(0, 24) : note.color
    const pinned = typeof body?.pinned === 'boolean' ? body.pinned : note.pinned
    const done = typeof body?.done === 'boolean' ? body.done : note.done
    const checklist = Array.isArray(body?.checklist) ? body.checklist : note.checklist

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO note_revisions (id, note_id, editor_id, snapshot)
         SELECT $1, $2, $3,
                jsonb_build_object('title', title, 'body', body, 'checklist', checklist, 'version', version)
           FROM notes WHERE id = $2`,
        [newId(), id, user.id]
      )
      await client.query(
        `UPDATE notes SET title=$1, body=$2, color=$3, pinned=$4, done=$5, checklist=$6,
                          version = version + 1, updated_at = now()
          WHERE id = $7 AND version = $8`,
        [title, text, color, pinned, done, JSON.stringify(checklist), id, baseVersion]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const fresh = await pool.query<NoteRow>(`${SELECT_NOTE} WHERE n.id = $1`, [id])
    const updated = mapNote(fresh.rows[0])
    await hub.publish(user.spaceId, 'note.updated', updated)
    return updated
  })

  app.delete('/api/v1/notes/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rowCount } = await pool.query(
      'UPDATE notes SET deleted_at = now() WHERE id = $1 AND space_id = $2 AND deleted_at IS NULL',
      [id, user.spaceId]
    )
    if (rowCount === 0) throw notFound('Not bulunamadı.')
    await hub.publish(user.spaceId, 'note.deleted', { id })
    return { ok: true }
  })

  app.get('/api/v1/notes/:id/revisions', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const check = await pool.query('SELECT 1 FROM notes WHERE id = $1 AND space_id = $2', [id, user.spaceId])
    if (check.rowCount === 0) throw notFound('Not bulunamadı.')
    const { rows } = await pool.query(
      `SELECT id, editor_id, snapshot, created_at FROM note_revisions
        WHERE note_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id]
    )
    return { revisions: rows }
  })
}
