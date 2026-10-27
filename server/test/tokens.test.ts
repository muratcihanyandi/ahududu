// Birim testler — parola hash, token, davet kodu.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPassword,
  verifyPassword,
  newToken,
  newInviteCode,
  isValidInviteCode,
  sha256,
  newId,
} from '../src/lib/tokens.ts'

test('parola hash ve doğrulama gidiş-dönüşü', async () => {
  const { hash, salt } = await hashPassword('gizli-parola')
  assert.match(hash, /^[0-9a-f]{128}$/)
  assert.match(salt, /^[0-9a-f]{32}$/)
  assert.equal(await verifyPassword('gizli-parola', salt, hash), true)
  assert.equal(await verifyPassword('yanlis-parola', salt, hash), false)
})

test('aynı tuzla hash deterministik', async () => {
  const a = await hashPassword('parola', 'sabit-tuz')
  const b = await hashPassword('parola', 'sabit-tuz')
  assert.equal(a.hash, b.hash)
})

test('token benzersiz ve hashlenebilir', () => {
  const t1 = newToken()
  const t2 = newToken()
  assert.notEqual(t1.token, t2.token)
  assert.equal(t1.tokenHash, sha256(t1.token))
  assert.ok(t1.token.length >= 40)
})

test('davet kodu alfabesi ve doğrulama', () => {
  for (let i = 0; i < 50; i++) {
    const code = newInviteCode()
    assert.equal(code.length, 8)
    assert.equal(isValidInviteCode(code), true)
    // Karıştırılabilir karakterler (I, O, 0, 1, L) kullanılmaz.
    assert.ok(!/[IOL01]/.test(code), `karıştırılabilir karakter: ${code}`)
  }
  assert.equal(isValidInviteCode('ABC'), false)
  assert.equal(isValidInviteCode('abcdefgh'), false)
  assert.equal(isValidInviteCode('A1CDEFGH'), false)
})

test('uuid üretimi', () => {
  const id = newId()
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.notEqual(id, newId())
})
