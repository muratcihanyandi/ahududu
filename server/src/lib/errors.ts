// Uygulama hataları — her hata Türkçe mesaj ve makine tarafından okunabilir kod taşır.
export class AppError extends Error {
  statusCode: number
  code: string
  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export const badRequest = (message: string): AppError => new AppError(400, 'bad_request', message)
export const unauthorized = (message = 'Oturum gerekli'): AppError => new AppError(401, 'unauthorized', message)
export const forbidden = (message = 'Bu işlem için yetkin yok'): AppError => new AppError(403, 'forbidden', message)
export const notFound = (message = 'Bulunamadı'): AppError => new AppError(404, 'not_found', message)
export const conflict = (message: string): AppError => new AppError(409, 'conflict', message)
export const tooMany = (message: string, retryAfterSec: number): AppError => {
  const e = new AppError(429, 'rate_limited', message)
  ;(e as AppError & { retryAfterSec?: number }).retryAfterSec = retryAfterSec
  return e
}
