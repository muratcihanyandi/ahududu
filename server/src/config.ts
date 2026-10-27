// Uygulama yapılandırması — tüm değerler ortam değişkenlerinden okunur.
export interface AppConfig {
  port: number
  databaseUrl: string
  mediaDir: string
  tokenTtlDays: number
  inviteTtlDays: number
  nodeEnv: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL ortam değişkeni gerekli. server/.env.example dosyasını incele.')
  }
  return {
    port: Number(env.PORT ?? 8787),
    databaseUrl,
    mediaDir: env.MEDIA_DIR ?? './media',
    tokenTtlDays: Number(env.TOKEN_TTL_DAYS ?? 180),
    inviteTtlDays: Number(env.INVITE_TTL_DAYS ?? 7),
    nodeEnv: env.NODE_ENV ?? 'development',
  }
}
