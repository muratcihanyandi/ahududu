// Yapılandırma servisi — ETag önbellekli, kimlik doğrulamalı.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../lib/context.ts'
import { requireAuth } from '../../lib/guard.ts'
import { ensureDefaultConfig, getLatestConfig } from './seed.ts'

export async function registerConfigRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool } = ctx

  app.get('/api/v1/config', async (request, reply) => {
    await requireAuth(pool, request)
    await ensureDefaultConfig(pool)
    const latest = await getLatestConfig(pool)
    if (!latest) {
      return reply.status(500).send({ error: { code: 'internal', message: 'Yapılandırma bulunamadı' } })
    }
    const etag = `"cfg-${latest.version}"`
    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).send()
    }
    return reply.status(200).header('etag', etag).send(latest.content)
  })
}
