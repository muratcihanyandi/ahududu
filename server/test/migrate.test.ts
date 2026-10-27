// Migration dosyaları ve koşucu — veritabanı gerektirmez.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitMigration, listMigrationFiles } from '../src/db/migrate.ts'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

test('splitMigration: up/down ayrımı', () => {
  const { up, down } = splitMigration('CREATE TABLE a (id int);\n\n-- +Down\nDROP TABLE a;')
  assert.equal(up.trim(), 'CREATE TABLE a (id int);')
  assert.equal(down?.trim(), 'DROP TABLE a;')
})

test('splitMigration: down bloğu yoksa null', () => {
  const { up, down } = splitMigration('SELECT 1;')
  assert.equal(up, 'SELECT 1;')
  assert.equal(down, null)
})

test('migration dosyaları sıralı ve adlandırılmış', async () => {
  const files = await listMigrationFiles()
  assert.ok(files.length >= 8, `en az 8 migration bekleniyor, bulunan: ${files.length}`)
  const sorted = [...files].sort()
  assert.deepEqual(files, sorted)
  for (const f of files) assert.match(f, /^\d{3}_[a-z_]+\.sql$/, `bozuk ad: ${f}`)
})

test('her migration geri alınabilir blok içerir', async () => {
  const files = await listMigrationFiles()
  for (const f of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8')
    const { up, down } = splitMigration(sql)
    assert.ok(up.trim().length > 0, `${f}: up bölümü boş`)
    assert.ok(down && down.trim().length > 0, `${f}: -- +Down bloğu eksik`)
  }
})

test('up bölümlerinde DROP yok, down bölümlerinde CREATE yok', async () => {
  const files = await listMigrationFiles()
  for (const f of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8')
    const { up, down } = splitMigration(sql)
    assert.ok(!/^\s*DROP TABLE/im.test(up), `${f}: up bölümünde DROP TABLE var`)
    assert.ok(!/^\s*CREATE TABLE/im.test(down ?? ''), `${f}: down bölümünde CREATE TABLE var`)
  }
})
