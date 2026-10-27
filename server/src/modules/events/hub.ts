// WebSocket olay hub'ı — uzay bazlı kanal, kalıcı olay sırası (seq) ve presence.
import type { Pool } from 'pg'
import type { WebSocket } from 'ws'

export interface EventEnvelope {
  type: string
  payload: unknown
  seq: number | null
  serverTs: string
}

export class EventHub {
  // spaceId -> (socket -> userId)
  private readonly spaces = new Map<string, Map<WebSocket, string>>()
  private readonly pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  add(spaceId: string, ws: WebSocket, userId: string): void {
    let set = this.spaces.get(spaceId)
    if (!set) {
      set = new Map()
      this.spaces.set(spaceId, set)
    }
    set.set(ws, userId)
  }

  remove(spaceId: string, ws: WebSocket): void {
    const set = this.spaces.get(spaceId)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) this.spaces.delete(spaceId)
  }

  onlineUsers(spaceId: string): string[] {
    return [...new Set(this.spaces.get(spaceId)?.values() ?? [])]
  }

  broadcastPresence(spaceId: string): void {
    const envelope: EventEnvelope = {
      type: 'presence.updated',
      payload: { online: this.onlineUsers(spaceId) },
      seq: null,
      serverTs: new Date().toISOString(),
    }
    this.sendTo(spaceId, JSON.stringify(envelope))
  }

  // Olayı kalıcı kuyruğa yazar (uzay başına monotoni) ve bağlı istemcilere dağıtır.
  async publish(spaceId: string, type: string, payload: unknown): Promise<void> {
    const { rows } = await this.pool.query(
      `UPDATE spaces SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq`,
      [spaceId]
    )
    if (rows.length === 0) return
    const seq = Number(rows[0].event_seq)
    await this.pool.query(
      `INSERT INTO events (space_id, seq, type, payload) VALUES ($1, $2, $3, $4)`,
      [spaceId, seq, type, JSON.stringify(payload)]
    )
    const envelope: EventEnvelope = { type, payload, seq, serverTs: new Date().toISOString() }
    this.sendTo(spaceId, JSON.stringify(envelope))
  }

  // Geçici / yüksek frekanslı olaylar (ör. canlı ses akışı) — veritabanına yazılmaz, doğrudan iletilir.
  forwardEphemeral(spaceId: string, type: string, payload: unknown, excludeUserId?: string): void {
    const envelope: EventEnvelope = {
      type,
      payload,
      seq: null,
      serverTs: new Date().toISOString(),
    }
    const text = JSON.stringify(envelope)
    const set = this.spaces.get(spaceId)
    if (!set) return
    for (const [ws, uId] of set) {
      if (excludeUserId && uId === excludeUserId) continue
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(text)
        } catch {
          this.remove(spaceId, ws)
        }
      }
    }
  }

  private sendTo(spaceId: string, text: string): void {
    const set = this.spaces.get(spaceId)
    if (!set) return
    for (const [ws] of set) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(text)
        } catch {
          this.remove(spaceId, ws)
        }
      }
    }
  }
}
