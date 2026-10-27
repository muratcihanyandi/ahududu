// Entegrasyon testi — gerçek veritabanı gerektirir.
// Çalıştırma: TEST_DATABASE_URL=postgresql://... npm test
// Test veritabanı boş/temiz bir 'ahududu_test' DB'si olmalı; veriler silinir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrateUp } from '../src/db/migrate.ts'
import { ensureDefaultConfig } from '../src/modules/config/seed.ts'
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../src/lib/context.ts'

const TEST_DB = process.env.TEST_DATABASE_URL

test(
  'auth akışı: kurulum → davet → katılım → oturum',
  { skip: !TEST_DB ? 'TEST_DATABASE_URL tanımlı değil — entegrasyon testi atlandı' : false },
  async () => {
    assert.ok(TEST_DB)
    const cfg = loadConfig({
      ...process.env,
      DATABASE_URL: TEST_DB,
      NODE_ENV: 'test',
      PORT: '0',
    })
    const { app, ctx } = await buildApp(cfg)
    try {
      const applied = await migrateUp(ctx.pool)
      assert.ok(Array.isArray(applied))
      await ctx.pool.query(
        `TRUNCATE spaces, users, space_members, devices, sessions, invites, events,
                messages, media_assets, albums, notes, letters, interactions,
                location_status, location_pings, health_samples, notifications_log CASCADE`
      )
      await ensureDefaultConfig(ctx.pool)
      await runAuthFlow(app, ctx)
    } finally {
      await app.close()
      await ctx.pool.end()
    }
  }
)

async function runAuthFlow(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // 1) Sağlık kontrolü
  let res = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().db, 'up')

  // 2) Yetkisiz istek reddedilir
  res = await app.inject({ method: 'GET', url: '/api/v1/me' })
  assert.equal(res.statusCode, 401)

  // 3) İlk kurulum
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: {
      spaceName: 'Bizim Alan',
      username: 'murat',
      displayName: 'Murat',
      password: 'parola-123',
    },
  })
  assert.equal(res.statusCode, 200, res.body)
  const setup = res.json()
  assert.ok(setup.token)
  assert.ok(setup.invite.code)
  const ownerToken = setup.token as string
  const inviteCode = setup.invite.code as string

  // 4) İkinci kurulum denemesi reddedilir
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { spaceName: 'X', username: 'baska', displayName: 'B', password: 'parola-1' },
  })
  assert.equal(res.statusCode, 409)

  // 5) Geçersiz parola ile giriş reddedilir
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'murat', password: 'yanlis' },
  })
  assert.equal(res.statusCode, 401)

  // 6) Doğru giriş
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'murat', password: 'parola-123', deviceName: 'S23' },
  })
  assert.equal(res.statusCode, 200, res.body)
  assert.ok(res.json().token)

  // 7) /me — üyeler ve cihazlar
  res = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { authorization: `Bearer ${ownerToken}` },
  })
  assert.equal(res.statusCode, 200)
  const me = res.json()
  assert.equal(me.user.username, 'murat')
  assert.equal(me.members.length, 1)
  // Adım 6'daki giriş deviceName ile yapıldı — cihaz kaydı görünmeli.
  assert.equal(me.devices.length, 1)
  assert.equal(me.devices[0].name, 'S23')
  assert.equal(me.devices[0].platform, 'android')

  // 8) Yapılandırma: ilk istek 200 + etag, ikinci 304
  res = await app.inject({
    method: 'GET',
    url: '/api/v1/config',
    headers: { authorization: `Bearer ${ownerToken}` },
  })
  assert.equal(res.statusCode, 200)
  const etag = res.headers.etag
  assert.ok(etag)
  assert.equal(res.json().schemaVersion, 1)
  res = await app.inject({
    method: 'GET',
    url: '/api/v1/config',
    headers: { authorization: `Bearer ${ownerToken}`, 'if-none-match': etag as string },
  })
  assert.equal(res.statusCode, 304)

  // 9) Davetle ikinci kullanıcı katılır
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/join',
    payload: {
      inviteCode,
      username: 'sevgilim',
      displayName: 'Sevgilim',
      password: 'parola-456',
    },
  })
  assert.equal(res.statusCode, 200, res.body)
  const member = res.json()
  assert.ok(member.token)
  const memberToken = member.token as string

  // 10) Kullanılmış davet kodu tekrar kullanılamaz
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/join',
    payload: { inviteCode, username: 'ucuncu', displayName: 'U', password: 'parola-789' },
  })
  assert.equal(res.statusCode, 404)

  // 11) Alan artık dolu — yeni davet kodu da katılımı engeller
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/space/invite',
    headers: { authorization: `Bearer ${ownerToken}` },
  })
  assert.equal(res.statusCode, 200, res.body)
  const newCode = res.json().code as string
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/join',
    payload: { inviteCode: newCode, username: 'ucuncu', displayName: 'U', password: 'parola-789' },
  })
  assert.equal(res.statusCode, 409)

  // 12) Üye, davet kodu oluşturamaz (yalnızca sahip)
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/space/invite',
    headers: { authorization: `Bearer ${memberToken}` },
  })
  assert.equal(res.statusCode, 409)

  // 13) Katılım olayı kuyrukta görünür
  res = await app.inject({
    method: 'GET',
    url: '/api/v1/events?since=0',
    headers: { authorization: `Bearer ${ownerToken}` },
  })
  assert.equal(res.statusCode, 200)
  const evts = res.json().events
  assert.ok(evts.some((e: { type: string }) => e.type === 'space.member_joined'))

  // 14) /space üyeleri gösterir
  res = await app.inject({
    method: 'GET',
    url: '/api/v1/space',
    headers: { authorization: `Bearer ${memberToken}` },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().members.length, 2)

  // 15) Çıkış sonrası token geçersiz
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${memberToken}` },
  })
  assert.equal(res.statusCode, 200)
  res = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { authorization: `Bearer ${memberToken}` },
  })
  assert.equal(res.statusCode, 401)

  // 16) Kullanıcı adı kuralı: büyük harf reddedilir
  res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { spaceName: 'Y', username: 'Buyuk', displayName: 'B', password: 'parola-1' },
  })
  assert.equal(res.statusCode, 400)
}
