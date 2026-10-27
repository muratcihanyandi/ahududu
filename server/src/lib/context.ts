// İstek bağımlılıklarını taşıyan uygulama bağlamı (manuel DI).
import type { Pool } from 'pg'
import type { AppConfig } from '../config.ts'
import type { RateLimiter } from './rate-limit.ts'
import type { EventHub } from '../modules/events/hub.ts'

export interface AppContext {
  pool: Pool
  config: AppConfig
  limiter: RateLimiter
  hub: EventHub
}
