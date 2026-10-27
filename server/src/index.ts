// Sunucu giriş noktası — migration, tohumlama, dinleme, zarif kapanış.
import { loadConfig } from './config.ts'
import { migrateUp } from './db/migrate.ts'
import { buildApp, APP_VERSION } from './app.ts'
import { ensureDefaultConfig } from './modules/config/seed.ts'

async function main(): Promise<void> {
  const cfg = loadConfig()
  const { app, ctx } = await buildApp(cfg)

  if (process.env.DISABLE_MIGRATIONS !== '1') {
    const applied = await migrateUp(ctx.pool)
    if (applied.length > 0) console.log('[startup] Uygulanan migration:', applied.join(', '))
  }
  await ensureDefaultConfig(ctx.pool)

  await app.listen({ port: cfg.port, host: '0.0.0.0' })
  console.log(`[startup] Ahududu sunucusu ${cfg.port} portunda dinliyor (v${APP_VERSION}, ${cfg.nodeEnv})`)

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[shutdown] ${signal} alındı, kapatılıyor...`)
    try {
      await app.close()
    } finally {
      await ctx.pool.end()
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  console.error('[startup] Hata:', err)
  process.exit(1)
})
