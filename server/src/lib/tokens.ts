// Parola hash (scrypt), oturum tokenı ve davet kodu yardımcıları.
import { randomBytes, scrypt, timingSafeEqual, createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export async function hashPassword(
  password: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const s = salt ?? randomBytes(16).toString('hex')
  const buf = await scryptAsync(password.normalize('NFKC'), s, 64, SCRYPT_PARAMS)
  return { hash: buf.toString('hex'), salt: s }
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// 32 bayt rastgele opak token; DB'de yalnızca sha256 hash'i saklanır.
export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: sha256(token) }
}

// Karıştırılabilir karakterler (I, O, L, 0, 1) içermeyen davet kodu alfabesi.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newInviteCode(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

export function isValidInviteCode(code: string): boolean {
  return /^[A-Z2-9]{8}$/.test(code)
}

export function newId(): string {
  return randomUUID()
}
