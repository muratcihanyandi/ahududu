// Uygulama sürüm kontrolü ve APK dağıtımı (yalnızca sunucuda dosya varsa).
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { notFound } from '../../lib/errors.ts'

export async function registerUpdatesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, config: cfg } = ctx
  const releasesDir = join(cfg.mediaDir, '..', 'releases')

  app.get('/api/v1/app/latest', async (request) => {
    const user = await requireAuth(pool, request)
    const q = request.query as { platform?: string }
    const platform = q.platform === 'wear' ? 'wear' : 'phone'
    const { rows } = await pool.query(
      `SELECT version_code, version_name, changelog, file_size, sha256, created_at
         FROM app_releases WHERE platform = $1 ORDER BY version_code DESC LIMIT 1`,
      [platform]
    )
    if (rows.length === 0) return { release: null }
    const r = rows[0]
    await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id])
    return {
      release: {
        platform,
        versionCode: r.version_code,
        versionName: r.version_name,
        changelog: r.changelog,
        sizeBytes: Number(r.file_size),
        sha256: r.sha256,
        createdAt: r.created_at,
        downloadPath: `/api/v1/app/download/${platform}/${r.version_code}`,
      },
    }
  })

  app.get('/api/v1/app/download/:platform/:versionCode', async (request, reply) => {
    await requireAuth(pool, request)
    const { platform, versionCode } = request.params as { platform: string; versionCode: string }
    const { rows } = await pool.query<{ file_path: string }>(
      `SELECT file_path FROM app_releases WHERE platform = $1 AND version_code = $2`,
      [platform === 'wear' ? 'wear' : 'phone', Number(versionCode)]
    )
    if (rows.length === 0) throw notFound('Sürüm bulunamadı.')
    const full = join(releasesDir, rows[0].file_path)
    try {
      const s = await stat(full)
      reply.header('content-length', String(s.size))
      reply.type('application/vnd.android.package-archive')
      reply.header('content-disposition', `attachment; filename="ahududu-${platform}-${versionCode}.apk"`)
      return reply.send(createReadStream(full))
    } catch {
      throw notFound('APK dosyası sunucuda bulunamadı.')
    }
  })
}
