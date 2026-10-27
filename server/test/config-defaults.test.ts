// Varsayılan yapılandırma belgesinin şekil kontrolü.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../src/modules/config/defaults.ts'

test('şema sürümü ve temel bölümler', () => {
  assert.equal(DEFAULT_CONFIG.schemaVersion, 1)
  assert.ok(DEFAULT_CONFIG.themes.available.length >= 2)
  assert.ok(DEFAULT_CONFIG.letters.papers.length >= 3)
  assert.ok(DEFAULT_CONFIG.letters.envelopes.length >= 1)
  assert.ok(DEFAULT_CONFIG.interactions.length >= 4)
})

test('tema renkleri tam ve geçerli hex', () => {
  const required = ['primary', 'background', 'surface', 'text', 'mutedText', 'accent']
  for (const theme of DEFAULT_CONFIG.themes.available) {
    for (const key of required) {
      const c = theme.colors[key]
      assert.ok(c, `${theme.id}: ${key} eksik`)
      assert.match(c, /^#[0-9A-Fa-f]{6}$/, `${theme.id}: ${key} geçersiz hex (${c})`)
    }
  }
  const active = DEFAULT_CONFIG.themes.available.find((t) => t.id === DEFAULT_CONFIG.themes.active)
  assert.ok(active, 'aktif tema tanımlı olmalı')
})

test('etkileşim tanımları tam ve cooldown pozitif', () => {
  for (const i of DEFAULT_CONFIG.interactions) {
    assert.ok(i.kind && i.label && i.message, `etkileşim eksik alan: ${JSON.stringify(i)}`)
    assert.ok(Number.isFinite(i.cooldownSec) && i.cooldownSec > 0, `${i.kind}: cooldownSec pozitif olmalı`)
    assert.equal(typeof i.notify, 'boolean')
  }
  const kinds = new Set(DEFAULT_CONFIG.interactions.map((i) => i.kind))
  for (const expected of ['attention', 'heart', 'kiss', 'hug']) {
    assert.ok(kinds.has(expected), `eksik etkileşim türü: ${expected}`)
  }
})

test('limitler pozitif ve featureFlags boolean', () => {
  assert.ok(DEFAULT_CONFIG.limits.imageMaxBytes > 0)
  assert.ok(DEFAULT_CONFIG.limits.videoMaxBytes > DEFAULT_CONFIG.limits.imageMaxBytes)
  for (const v of Object.values(DEFAULT_CONFIG.featureFlags)) {
    assert.equal(typeof v, 'boolean')
  }
})
