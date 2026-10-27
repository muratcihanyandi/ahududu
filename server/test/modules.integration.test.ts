// Yeni modüller entegrasyon testi — mesajlaşma, notlar, etkileşim, mektup, konum/sağlık.
// TEST_DATABASE_URL tanımlıysa çalışır.
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
  'modüller: mesaj, not, etkileşim, mektup, konum, sağlık',
  { skip: !TEST_DB ? 'TEST_DATABASE_URL tanımlı değil' : false },
  async () => {
    const cfg = loadConfig({ ...process.env, DATABASE_URL: TEST_DB!, NODE_ENV: 'test', PORT: '0' })
    const { app, ctx } = await buildApp(cfg)
    try {
      await migrateUp(ctx.pool)
      await ctx.pool.query(
        `TRUNCATE spaces, users, space_members, devices, sessions, invites, events,
                messages, message_attachments, message_receipts, message_reactions,
                media_assets, albums, album_items, notes, note_revisions, letters, letter_pages,
                letter_favorites, interactions, location_status, location_pings, health_samples,
                device_buzzes, notifications_log CASCADE`
      )
      await ensureDefaultConfig(ctx.pool)
      await runModuleFlow(app, ctx)
    } finally {
      await app.close()
      await ctx.pool.end()
    }
  }
)

async function setupUsers(app: FastifyInstance) {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { spaceName: 'Test', username: 'murat', displayName: 'Murat', password: 'parola-123' },
  })
  assert.equal(setup.statusCode, 200, setup.body)
  const owner = setup.json()
  const join = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/join',
    payload: {
      inviteCode: owner.invite.code, username: 'selin', displayName: 'Selin', password: 'parola-456',
    },
  })
  assert.equal(join.statusCode, 200, join.body)
  return { ownerToken: owner.token as string, memberToken: join.json().token as string }
}

async function runModuleFlow(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { ownerToken, memberToken } = await setupUsers(app)
  const owner = { authorization: `Bearer ${ownerToken}` }
  const member = { authorization: `Bearer ${memberToken}` }

  // ===== MESAJLAR =====
  const m1 = await app.inject({
    method: 'POST', url: '/api/v1/messages', headers: owner,
    payload: { clientMsgId: 'c-1', body: 'İlk mesaj' },
  })
  assert.equal(m1.statusCode, 200, m1.body)
  const message = m1.json()
  assert.equal(message.body, 'İlk mesaj')
  assert.equal(message.mine, true)

  // Idempotency: aynı clientMsgId tekrar → aynı mesaj, yeni kayıt yok
  const m1again = await app.inject({
    method: 'POST', url: '/api/v1/messages', headers: owner,
    payload: { clientMsgId: 'c-1', body: 'İlk mesaj' },
  })
  assert.equal(m1again.json().id, message.id)
  const countAfter = await ctx.pool.query('SELECT count(*)::int AS n FROM messages')
  assert.equal(countAfter.rows[0].n, 1, 'idempotent gönderim ikinci kayıt oluşturmamalı')

  // Boş mesaj reddedilir
  const empty = await app.inject({
    method: 'POST', url: '/api/v1/messages', headers: owner,
    payload: { clientMsgId: 'c-2', body: '   ' },
  })
  assert.equal(empty.statusCode, 400)

  // Karşı taraf geçmişi görür
  const history = await app.inject({ method: 'GET', url: '/api/v1/messages', headers: member })
  assert.equal(history.statusCode, 200)
  assert.equal(history.json().messages.length, 1)
  assert.equal(history.json().messages[0].mine, false)

  // Yanıt + tepki
  const reply = await app.inject({
    method: 'POST', url: '/api/v1/messages', headers: member,
    payload: { clientMsgId: 'c-3', body: 'Yanıt', replyToId: message.id },
  })
  assert.equal(reply.statusCode, 200, reply.body)
  assert.equal(reply.json().replyToId, message.id)

  const reacted = await app.inject({
    method: 'POST', url: `/api/v1/messages/${message.id}/reactions`, headers: member,
    payload: { reaction: '❤' },
  })
  assert.equal(reacted.statusCode, 200)
  assert.equal(reacted.json().reactions.length, 1)

  // Okundu
  const read = await app.inject({ method: 'POST', url: '/api/v1/messages/read', headers: member })
  assert.ok(read.json().marked >= 1)
  const unread = await app.inject({ method: 'GET', url: '/api/v1/messages/unread', headers: member })
  assert.equal(unread.json().unread, 0)

  // Başkasının mesajını düzenleme reddedilir
  const forbiddenEdit = await app.inject({
    method: 'PATCH', url: `/api/v1/messages/${message.id}`, headers: member,
    payload: { body: 'hack' },
  })
  assert.equal(forbiddenEdit.statusCode, 403)

  // Silme → gövde gizlenir
  const deleted = await app.inject({
    method: 'DELETE', url: `/api/v1/messages/${message.id}`, headers: owner,
  })
  assert.equal(deleted.statusCode, 200)
  assert.equal(deleted.json().deleted, true)
  assert.equal(deleted.json().body, '')

  // ===== NOTLAR (sürüm çakışması) =====
  const noteRes = await app.inject({
    method: 'POST', url: '/api/v1/notes', headers: owner,
    payload: { title: 'Alışveriş', body: 'Süt, ekmek', checklist: [] },
  })
  assert.equal(noteRes.statusCode, 200, noteRes.body)
  const note = noteRes.json()
  assert.equal(note.version, 1)

  const upd1 = await app.inject({
    method: 'PATCH', url: `/api/v1/notes/${note.id}`, headers: owner,
    payload: { baseVersion: 1, title: 'Alışveriş', body: 'Süt, ekmek, kahve' },
  })
  assert.equal(upd1.statusCode, 200, upd1.body)
  assert.equal(upd1.json().version, 2)

  // Eski sürümle güncelleme → 409 + güncel belge
  const conflictRes = await app.inject({
    method: 'PATCH', url: `/api/v1/notes/${note.id}`, headers: member,
    payload: { baseVersion: 1, body: 'Benim değişikliğim' },
  })
  assert.equal(conflictRes.statusCode, 409)
  const conflictBody = conflictRes.json()
  assert.equal(conflictBody.error.code, 'version_conflict')
  assert.equal(conflictBody.current.version, 2)
  assert.equal(conflictBody.current.body, 'Süt, ekmek, kahve')

  // baseVersion olmadan güncelleme reddedilir
  const noBase = await app.inject({
    method: 'PATCH', url: `/api/v1/notes/${note.id}`, headers: member, payload: { body: 'x' },
  })
  assert.equal(noBase.statusCode, 400)

  // Revizyon geçmişi kaydedildi
  const revs = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}/revisions`, headers: owner })
  assert.ok(revs.json().revisions.length >= 1)

  // ===== ETKİLEŞİMLER (rate limit) =====
  const inter = await app.inject({
    method: 'POST', url: '/api/v1/interactions', headers: owner,
    payload: { kind: 'attention' },
  })
  assert.equal(inter.statusCode, 200, inter.body)
  const again = await app.inject({
    method: 'POST', url: '/api/v1/interactions', headers: owner,
    payload: { kind: 'attention' },
  })
  assert.equal(again.statusCode, 429, 'cooldown içinde ikinci istek 429 olmalı')
  assert.ok(Number(again.headers['retry-after']) > 0)

  // Farklı tür serbest
  const heart = await app.inject({
    method: 'POST', url: '/api/v1/interactions', headers: owner, payload: { kind: 'heart' },
  })
  assert.equal(heart.statusCode, 200)

  // Karşı taraf yanıtlar
  const answer = await app.inject({
    method: 'POST', url: `/api/v1/interactions/${inter.json().id}/answer`, headers: member,
    payload: { reply: 'Buradayım 💗' },
  })
  assert.equal(answer.statusCode, 200, answer.body)

  // Gönderen kendi etkileşimini yanıtlayamaz
  const selfAnswer = await app.inject({
    method: 'POST', url: `/api/v1/interactions/${inter.json().id}/answer`, headers: owner,
    payload: { reply: 'x' },
  })
  assert.equal(selfAnswer.statusCode, 404)

  // ===== MEKTUPLAR =====
  const draft = await app.inject({
    method: 'POST', url: '/api/v1/letters', headers: owner,
    payload: { clientDraftId: 'draft-1', title: 'Sana', bodyMd: 'Sevgilim,' },
  })
  assert.equal(draft.statusCode, 200, draft.body)
  const draftId = draft.json().id
  assert.equal(draft.json().status, 'draft')

  // Aynı clientDraftId → aynı taslak (otomatik kayıt idempotent)
  const draftAgain = await app.inject({
    method: 'POST', url: '/api/v1/letters', headers: owner,
    payload: { clientDraftId: 'draft-1', title: 'Sana', bodyMd: 'Sevgilim, seni' },
  })
  assert.equal(draftAgain.json().id, draftId)

  // Taslak karşı tarafa görünmez
  const otherDrafts = await app.inject({ method: 'GET', url: '/api/v1/letters?box=drafts', headers: member })
  assert.equal(otherDrafts.json().letters.length, 0)
  const peek = await app.inject({ method: 'GET', url: `/api/v1/letters/${draftId}`, headers: member })
  assert.equal(peek.statusCode, 403)

  // Çizim sayfası kaydı (vektörel stroke)
  const withDrawing = await app.inject({
    method: 'PATCH', url: `/api/v1/letters/${draftId}`, headers: owner,
    payload: {
      pages: [{
        pageNo: 1,
        background: 'lined',
        strokes: [
          { tool: 'pen', color: '#C4536B', width: 3.5, points: [[10, 20, 0.4], [12.5, 24, 0.8]] },
          { tool: 'eraser', color: '#000000', width: 20, points: [[30, 40, 1]] },
          { tool: 'gecersiz', color: 'bad', width: 3, points: [[1, 2]] },
        ],
      }],
    },
  })
  assert.equal(withDrawing.statusCode, 200, withDrawing.body)
  const detail = await app.inject({ method: 'GET', url: `/api/v1/letters/${draftId}`, headers: owner })
  assert.equal(detail.json().pages.length, 1)
  assert.equal(detail.json().pages[0].background, 'lined')
  assert.equal(detail.json().pages[0].strokes.length, 2, 'geçersiz çizgi filtrelenmeli')
  assert.equal(detail.json().pages[0].strokes[0].points.length, 2)

  // Boş mektup gönderilemez
  const emptyDraft = await app.inject({
    method: 'POST', url: '/api/v1/letters', headers: member,
    payload: { clientDraftId: 'empty', title: '', bodyMd: '' },
  })
  const emptySend = await app.inject({
    method: 'POST', url: `/api/v1/letters/${emptyDraft.json().id}/send`, headers: member,
  })
  assert.equal(emptySend.statusCode, 400)

  // Gönderim
  const sent = await app.inject({
    method: 'POST', url: `/api/v1/letters/${draftId}/send`, headers: owner,
  })
  assert.equal(sent.statusCode, 200, sent.body)
  assert.equal(sent.json().status, 'sent')

  // Gönderildikten sonra düzenlenemez
  const editSent = await app.inject({
    method: 'PATCH', url: `/api/v1/letters/${draftId}`, headers: owner, payload: { title: 'x' },
  })
  assert.equal(editSent.statusCode, 400)

  // Karşı taraf gelen kutusunda görür ve okur
  const inbox = await app.inject({ method: 'GET', url: '/api/v1/letters?box=inbox', headers: member })
  assert.equal(inbox.json().letters.length, 1)
  const readLetter = await app.inject({
    method: 'POST', url: `/api/v1/letters/${draftId}/read`, headers: member,
  })
  assert.equal(readLetter.statusCode, 200)
  const afterRead = await app.inject({ method: 'GET', url: `/api/v1/letters/${draftId}`, headers: member })
  assert.equal(afterRead.json().status, 'read')
  assert.ok(afterRead.json().firstReadAt !== null)

  // Favori
  await app.inject({ method: 'POST', url: `/api/v1/letters/${draftId}/favorite`, headers: member })
  const favs = await app.inject({ method: 'GET', url: '/api/v1/letters?favorite=1', headers: member })
  assert.equal(favs.json().letters.length, 1)

  // ===== KONUM =====
  const locOn = await app.inject({
    method: 'PUT', url: '/api/v1/location/status', headers: owner,
    payload: { sharing: 'on', lat: 41.0082, lng: 28.9784, accuracyM: 25, recordedAt: new Date().toISOString() },
  })
  assert.equal(locOn.statusCode, 200, locOn.body)

  const partnerLoc = await app.inject({ method: 'GET', url: '/api/v1/location/partner', headers: member })
  assert.equal(partnerLoc.statusCode, 200)
  assert.equal(partnerLoc.json().partner.sharing, 'on')
  assert.ok(Math.abs(partnerLoc.json().partner.lat - 41.0082) < 0.0001)
  assert.equal(partnerLoc.json().partner.fresh, true)

  // Kapatınca koordinatlar silinir
  await app.inject({
    method: 'PUT', url: '/api/v1/location/status', headers: owner, payload: { sharing: 'off' },
  })
  const offLoc = await app.inject({ method: 'GET', url: '/api/v1/location/partner', headers: member })
  assert.equal(offLoc.json().partner.sharing, 'off')
  assert.equal(offLoc.json().partner.lat, null, 'paylaşım kapalıyken koordinat kalmamalı')

  // ===== SAĞLIK =====
  const hr = await app.inject({
    method: 'POST', url: '/api/v1/health/samples', headers: owner,
    payload: { type: 'heart_rate', value: 72, recordedAt: new Date().toISOString(), source: 'watch' },
  })
  assert.equal(hr.statusCode, 200, hr.body)
  const partnerHr = await app.inject({
    method: 'GET', url: '/api/v1/health/partner?type=heart_rate', headers: member,
  })
  assert.equal(partnerHr.json().partner.sample.value, 72)
  assert.equal(partnerHr.json().partner.sample.stale, false)

  // Stres verisi reddedilir (desteklenmiyor)
  const stress = await app.inject({
    method: 'POST', url: '/api/v1/health/samples', headers: owner,
    payload: { type: 'stress', value: 40 },
  })
  assert.equal(stress.statusCode, 400)

  // Adım: aynı gün ikinci kayıt öncekini değiştirir (çift sayım yok)
  await app.inject({
    method: 'POST', url: '/api/v1/health/samples', headers: owner,
    payload: { type: 'steps', value: 3000, recordedAt: new Date().toISOString() },
  })
  await app.inject({
    method: 'POST', url: '/api/v1/health/samples', headers: owner,
    payload: { type: 'steps', value: 4500, recordedAt: new Date().toISOString() },
  })
  const stepsCount = await ctx.pool.query(
    `SELECT count(*)::int AS n FROM health_samples WHERE type = 'steps'`
  )
  assert.equal(stepsCount.rows[0].n, 1, 'aynı gün için tek adım kaydı olmalı')
  const mySteps = await app.inject({ method: 'GET', url: '/api/v1/health/me?type=steps', headers: owner })
  assert.equal(mySteps.json().sample.value, 4500)

  // ===== TİTREŞİM (cihaz komutu) =====
  const buzz = await app.inject({
    method: 'POST', url: '/api/v1/devices/buzz', headers: owner,
    payload: { pattern: 'heartbeat', note: 'seni düşündüm', source: 'phone' },
  })
  assert.equal(buzz.statusCode, 200, buzz.body)
  assert.equal(buzz.json().pattern, 'heartbeat')
  assert.notEqual(buzz.json().senderId, buzz.json().targetId, 'hedef göndericiden farklı olmalı')

  // Karşı taraf kendine gelen titreşimi okur
  const incoming = await app.inject({ method: 'GET', url: '/api/v1/devices/buzz', headers: member })
  assert.equal(incoming.statusCode, 200)
  assert.equal(incoming.json().buzzes.length, 1)
  assert.equal(incoming.json().buzzes[0].pattern, 'heartbeat')
  assert.equal(incoming.json().buzzes[0].note, 'seni düşündüm')

  // Aynı desen cooldown içinde tekrar gönderilemez
  const buzzAgain = await app.inject({
    method: 'POST', url: '/api/v1/devices/buzz', headers: owner, payload: { pattern: 'heartbeat' },
  })
  assert.equal(buzzAgain.statusCode, 429)
  assert.ok(buzzAgain.headers['retry-after'], 'Retry-After başlığı olmalı')

  // Bilinmeyen desen reddedilir
  const badPattern = await app.inject({
    method: 'POST', url: '/api/v1/devices/buzz', headers: owner, payload: { pattern: 'yok' },
  })
  assert.equal(badPattern.statusCode, 400)

  // ===== YETKİ İZOLASYONU =====
  // Başka uzaydan erişim: geçersiz token
  const badToken = await app.inject({
    method: 'GET', url: '/api/v1/notes', headers: { authorization: 'Bearer sahte-token' },
  })
  assert.equal(badToken.statusCode, 401)
}
