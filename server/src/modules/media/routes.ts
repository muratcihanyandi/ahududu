// Medya modülü — dosya yükleme, küçük resim üretimi, galeri ve albümler.
import { createReadStream } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { badRequest, forbidden, notFound } from '../../lib/errors.ts'
import { newId } from '../../lib/tokens.ts'
import { sha256 } from '../../lib/tokens.ts'

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'])
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm'])

interface MediaRow {
  id: string
  kind: string
  original_path: string
  thumb_path: string | null
  mime: string
  size_bytes: string | number
  width: number | null
  height: number | null
  duration_ms: number | null
  caption: string
  taken_at: Date | null
  created_at: Date
  uploaded_by: string
  uploader_name: string
}

export function mapMedia(r: MediaRow) {
  return {
    id: r.id,
    kind: r.kind,
    mime: r.mime,
    sizeBytes: Number(r.size_bytes),
    width: r.width,
    height: r.height,
    durationMs: r.duration_ms,
    caption: r.caption,
    takenAt: r.taken_at,
    createdAt: r.created_at,
    uploadedBy: r.uploaded_by,
    uploaderName: r.uploader_name,
    hasThumb: r.thumb_path !== null,
  }
}

const SELECT_MEDIA = `
  SELECT ma.*, u.display_name AS uploader_name FROM media_assets ma
    JOIN users u ON u.id = ma.uploaded_by`

export async function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, hub, config: cfg } = ctx
  const mediaRoot = cfg.mediaDir
  await mkdir(join(mediaRoot, 'orig'), { recursive: true })
  await mkdir(join(mediaRoot, 'thumb'), { recursive: true })

  app.post('/api/v1/media', async (request, reply) => {
    const user = await requireAuth(pool, request)
    const part = await request.file({ limits: { fileSize: 220 * 1024 * 1024, files: 1 } })
    if (!part) throw badRequest('Dosya gerekli.')
    const mime = part.mimetype || 'application/octet-stream'
    const isImage = IMAGE_MIMES.has(mime)
    const isVideo = VIDEO_MIMES.has(mime)
    const isAudio = AUDIO_MIMES.has(mime)
    if (!isImage && !isVideo && !isAudio) {
      throw badRequest('Desteklenmeyen dosya türü. Fotoğraf, video veya ses gönderebilirsin.')
    }
    const limit = isImage ? 26_214_400 : 209_715_200
    const kind = isImage ? 'image' : isVideo ? 'video' : 'audio'
    const id = newId()
    const ext = extensionFor(mime)
    const origName = `${id}${ext}`
    const origPath = join(mediaRoot, 'orig', origName)
    const out = createWriteStream(origPath)
    let size = 0
    try {
      await pipeline(part.file, async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length
          if (size > limit) throw badRequest(`Dosya çok büyük (üst sınır ${Math.round(limit / 1048576)} MB).`)
          yield chunk
        }
      }, out)
    } catch (err) {
      await unlink(origPath).catch(() => {})
      throw err
    }

    let width: number | null = null
    let height: number | null = null
    let durationMs: number | null = null
    let thumbPath: string | null = null

    if (isImage) {
      try {
        const { default: sharp } = await import('sharp')
        const meta = await sharp(origPath).metadata()
        width = meta.width ?? null
        height = meta.height ?? null
        const thumbName = `${id}.webp`
        await sharp(origPath)
          .rotate()
          .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(join(mediaRoot, 'thumb', thumbName))
        thumbPath = `thumb/${thumbName}`
      } catch (e) {
        request.log.warn({ err: (e as Error).message }, 'küçük resim üretilemedi')
      }
    }

    const fields = part.fields as Record<string, { value?: unknown } | undefined>
    const caption = typeof fields?.caption?.value === 'string' ? (fields.caption.value as string).slice(0, 500) : ''
    const takenAtRaw = typeof fields?.takenAt?.value === 'string' ? (fields.takenAt.value as string) : null
    const takenAt = takenAtRaw && !Number.isNaN(new Date(takenAtRaw).getTime()) ? new Date(takenAtRaw) : null

    await pool.query(
      `INSERT INTO media_assets
        (id, space_id, uploaded_by, kind, original_path, thumb_path, mime, size_bytes,
         width, height, duration_ms, caption, taken_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id, user.spaceId, user.id, kind, `orig/${origName}`, thumbPath, mime, size,
        width, height, durationMs, caption, takenAt,
      ]
    )
    const { rows } = await pool.query<MediaRow>(`${SELECT_MEDIA} WHERE ma.id = $1`, [id])
    const media = mapMedia(rows[0])
    await hub.publish(user.spaceId, 'media.new', media)
    return reply.status(201).send(media)
  })

  app.get('/api/v1/media', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { before?: string; limit?: string; kind?: string; favorite?: string }
    const limit = Math.min(Number(q.limit ?? 60) || 60, 200)
    const params: unknown[] = [user.spaceId]
    let where = 'ma.space_id = $1 AND ma.deleted_at IS NULL'
    if (q.kind === 'image' || q.kind === 'video') {
      params.push(q.kind)
      where += ` AND ma.kind = $${params.length}`
    }
    if (q.before) {
      const before = new Date(q.before)
      if (!Number.isNaN(before.getTime())) {
        params.push(before)
        where += ` AND ma.created_at < $${params.length}`
      }
    }
    params.push(limit)
    const { rows } = await pool.query<MediaRow>(
      `${SELECT_MEDIA} WHERE ${where} ORDER BY ma.created_at DESC LIMIT $${params.length}`,
      params
    )
    return { items: rows.map(mapMedia) }
  })

  app.patch('/api/v1/media/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const caption = typeof body?.caption === 'string' ? body.caption.slice(0, 500) : null
    if (caption === null) throw badRequest('caption gerekli.')
    const { rowCount } = await pool.query(
      'UPDATE media_assets SET caption = $1 WHERE id = $2 AND space_id = $3 AND deleted_at IS NULL',
      [caption, id, user.spaceId]
    )
    if (rowCount === 0) throw notFound('Medya bulunamadı.')
    const { rows } = await pool.query<MediaRow>(`${SELECT_MEDIA} WHERE ma.id = $1`, [id])
    const media = mapMedia(rows[0])
    await hub.publish(user.spaceId, 'media.updated', media)
    return media
  })

  app.delete('/api/v1/media/:id', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const { rows } = await pool.query<{ original_path: string; thumb_path: string | null }>(
      `UPDATE media_assets SET deleted_at = now()
        WHERE id = $1 AND space_id = $2 AND uploaded_by = $3 AND deleted_at IS NULL
        RETURNING original_path, thumb_path`,
      [id, user.spaceId, user.id]
    )
    if (rows.length === 0) throw forbidden('Yalnızca kendi yüklediğin dosyayı silebilirsin.')
    // Dosyalar hemen silinmez; 30 gün sonra temizlik işi kaldırır (yanlışlıkla silmeye karşı).
    await hub.publish(user.spaceId, 'media.deleted', { id })
    return { ok: true }
  })

  // Dosya sunumu — yalnızca aynı uzayın üyeleri.
  app.get('/api/v1/media/:id/file', async (request, reply) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const q = request.query as { thumb?: string }
    const { rows } = await pool.query<{ original_path: string; thumb_path: string | null; mime: string }>(
      'SELECT original_path, thumb_path, mime FROM media_assets WHERE id = $1 AND space_id = $2 AND deleted_at IS NULL',
      [id, user.spaceId]
    )
    if (rows.length === 0) throw notFound('Medya bulunamadı.')
    const useThumb = q.thumb === '1' && rows[0].thumb_path
    const rel = useThumb ? rows[0].thumb_path! : rows[0].original_path
    const full = join(mediaRoot, rel)
    try {
      const s = await stat(full)
      reply.header('content-length', String(s.size))
      reply.header('cache-control', 'private, max-age=86400')
      reply.type(useThumb ? 'image/webp' : rows[0].mime)
      return reply.send(createReadStream(full))
    } catch {
      throw notFound('Dosya diskte bulunamadı.')
    }
  })

  // Albümler
  app.get('/api/v1/albums', async (request) => {
    const user = await requireAuth(pool, request)
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.cover_media_id, a.created_at,
              (SELECT count(*)::int FROM album_items ai WHERE ai.album_id = a.id) AS item_count
         FROM albums a WHERE a.space_id = $1 ORDER BY a.created_at DESC`,
      [user.spaceId]
    )
    return { albums: rows }
  })

  app.post('/api/v1/albums', async (request) => {
    const user = await requireAuth(pool, request)
    const body = request.body as Record<string, unknown>
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!title || title.length > 80) throw badRequest('Albüm adı 1-80 karakter olmalı.')
    const id = newId()
    await pool.query('INSERT INTO albums (id, space_id, title, created_by) VALUES ($1, $2, $3, $4)', [
      id, user.spaceId, title, user.id,
    ])
    return { id, title, coverMediaId: null, itemCount: 0 }
  })

  app.post('/api/v1/albums/:id/items', async (request) => {
    const user = await requireAuth(pool, request)
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const mediaId = typeof body?.mediaId === 'string' ? body.mediaId : ''
    if (!mediaId) throw badRequest('mediaId gerekli.')
    const check = await pool.query('SELECT 1 FROM albums WHERE id = $1 AND space_id = $2', [id, user.spaceId])
    if (check.rowCount === 0) throw notFound('Albüm bulunamadı.')
    await pool.query(
      `INSERT INTO album_items (album_id, media_id, added_by) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, mediaId, user.id]
    )
    return { ok: true }
  })

  app.delete('/api/v1/albums/:id/items/:mediaId', async (request) => {
    const user = await requireAuth(pool, request)
    const { id, mediaId } = request.params as { id: string; mediaId: string }
    await pool.query('DELETE FROM album_items WHERE album_id = $1 AND media_id = $2', [id, mediaId])
    return { ok: true }
  })

  app.get('/api/v1/storage', async (request) => {
    const user = await requireAuth(pool, request)
    const { rows } = await pool.query(
      `SELECT count(*)::int AS files, COALESCE(sum(size_bytes), 0)::bigint AS total_bytes
         FROM media_assets WHERE space_id = $1 AND deleted_at IS NULL`,
      [user.spaceId]
    )
    return { files: rows[0].files, totalBytes: Number(rows[0].total_bytes) }
  })
}

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/3gpp': '.3gp',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/webm': '.weba',
  }
  return map[mime] ?? '.bin'
}
