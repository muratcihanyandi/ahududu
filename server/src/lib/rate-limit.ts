// Bellek içi kayan pencere rate limit — iki kullanıcılı sistem için yeterli ve dış bağımlılıksız.
export interface RateCheck {
  ok: boolean
  retryAfterSec: number
}

export type RateLimiter = (key: string, limit: number, windowMs: number) => RateCheck

export function makeRateLimiter(): RateLimiter {
  const hits = new Map<string, number[]>()
  return (key, limit, windowMs) => {
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= limit) {
      const waitMs = windowMs - (now - recent[0])
      hits.set(key, recent)
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) }
    }
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 10_000) {
      // Aşırı büyümeyi engelle (IP sayısı sınırlı bir ev ağı için pratikte gerekmez).
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= windowMs)) hits.delete(k)
      }
    }
    return { ok: true, retryAfterSec: 0 }
  }
}

export function clientIp(request: { headers: { [k: string]: string | string[] | undefined } }): string {
  const fwd = request.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim()
  return 'yerel'
}
