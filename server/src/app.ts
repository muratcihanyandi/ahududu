// Fastify uygulaması — modüllerin kaydı, hata işleme, sağlık kontrolü.
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import type { AppConfig } from './config.ts'
import { createPool } from './db/pool.ts'
import { makeRateLimiter } from './lib/rate-limit.ts'
import { AppError } from './lib/errors.ts'
import type { AppContext } from './lib/context.ts'
import { EventHub } from './modules/events/hub.ts'
import { registerEventsModule } from './modules/events/routes.ts'
import { registerAuthRoutes } from './modules/auth/routes.ts'
import { registerConfigRoutes } from './modules/config/routes.ts'
import { registerMessagingRoutes } from './modules/messaging/routes.ts'
import { registerMediaRoutes } from './modules/media/routes.ts'
import { registerNotesRoutes } from './modules/notes/routes.ts'
import { registerInteractionsRoutes } from './modules/interactions/routes.ts'
import { registerLettersRoutes } from './modules/letters/routes.ts'
import { registerLocationHealthRoutes } from './modules/health/routes.ts'
import { registerDevicesRoutes } from './modules/devices/routes.ts'
import { registerUpdatesRoutes } from './modules/updates/routes.ts'

export const APP_VERSION = '0.1.0'

export async function buildApp(cfg: AppConfig): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const pool = createPool(cfg.databaseUrl)
  const hub = new EventHub(pool)
  const ctx: AppContext = { pool, config: cfg, limiter: makeRateLimiter(), hub }

  const app = Fastify({
    logger: cfg.nodeEnv === 'test' ? false : { level: cfg.nodeEnv === 'production' ? 'info' : 'debug' },
    bodyLimit: 1024 * 1024,
  })

  // Dosya yükleme (multipart) — medya modülü için.
  await app.register(multipart, {
    limits: { fileSize: 220 * 1024 * 1024, files: 1 },
  })

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    if (err instanceof AppError) {
      const retryAfter = (err as AppError & { retryAfterSec?: number }).retryAfterSec
      if (retryAfter !== undefined) reply.header('retry-after', String(retryAfter))
      request.log.warn({ code: err.code }, err.message)
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: 'bad_request', message: err.message } })
    }
    request.log.error(err)
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'Sunucuda beklenmeyen bir hata oluştu.' } })
  })

  app.get('/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1')
      return reply.send({ status: 'ok', db: 'up', version: APP_VERSION })
    } catch {
      return reply.status(503).send({ status: 'degraded', db: 'down', version: APP_VERSION })
    }
  })

  await registerAuthRoutes(app, ctx)
  await registerConfigRoutes(app, ctx)
  await registerEventsModule(app, ctx)
  await registerMessagingRoutes(app, ctx)
  await registerMediaRoutes(app, ctx)
  await registerNotesRoutes(app, ctx)
  await registerInteractionsRoutes(app, ctx)
  await registerLettersRoutes(app, ctx)
  await registerLocationHealthRoutes(app, ctx)
  await registerDevicesRoutes(app, ctx)
  await registerUpdatesRoutes(app, ctx)

  return { app, ctx }
}
