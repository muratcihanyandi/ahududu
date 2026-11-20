/**
 * FarmingService — planting, harvesting, animal feeding/taming.
 * Extracted from WorldRoom.ts.
 */
import { type Player, MONSTERS, ITEMS, MAPS, type MapId, plantStage, PlantNode } from "@game/shared";
import type { Client } from "@colyseus/core";

function countItem(p: Player, itemId: string): number {
  let n = 0;
  for (const s of p.inventory) if (s.itemId === itemId) n += s.qty;
  return n;
}

function removeItem(p: Player, itemId: string, qty: number) {
  let need = qty;
  for (let i = p.inventory.length - 1; i >= 0 && need > 0; i--) {
    const s = p.inventory[i];
    if (s.itemId !== itemId) continue;
    const take = Math.min(s.qty, need);
    s.qty -= take;
    need -= take;
    if (s.qty <= 0) p.inventory.splice(i, 1);
  }
}

export class FarmingService {
  constructor(
    private state: {
      players: Map<string, Player>;
      monsters: Map<string, any>;
      plants: Map<string, PlantNode>;
      mapId: string;
    },
    private addToInventory: (p: Player, itemId: string, qty: number) => boolean,
    private bumpAchievement: (sid: string, counter: string, by?: number) => void,
    private lastAttack: Map<string, any>,
    private statusTickAcc: Map<string, number>,
    private monsterSpawn: Map<string, { x: number; z: number; kind: string }>,
    private tameProgress: Map<string, number>,
  ) {}

  handlePlantSeed(client: Client) {
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (!p || p.dead) return;
    if (countItem(p, "berry_seed") < 1) {
      client.send("system", { text: "Çilek tohumu yok" });
      return;
    }
    let mine = 0;
    for (const [, pl] of this.state.plants) if (pl.ownerName === p.name) mine++;
    if (mine >= 8) {
      client.send("system", { text: "En fazla 8 bitki ekebilirsin" });
      return;
    }
    const mapDef = MAPS[this.state.mapId as MapId];
    for (const w of mapDef.waters ?? []) {
      if (Math.hypot(p.pos.x - w.x, p.pos.z - w.z) < w.radius) {
        client.send("system", { text: "Suya ekim yapılamaz" });
        return;
      }
    }
    removeItem(p, "berry_seed", 1);
    const id = "plant_" + Math.random().toString(36).slice(2, 9);
    const node = new PlantNode();
    node.id = id;
    node.ownerName = p.name;
    node.pos.x = p.pos.x;
    node.pos.z = p.pos.z;
    node.plantedAt = Date.now();
    this.state.plants.set(id, node);
    client.send("system", { text: "🌱 Tohum ekildi — 3 dakika bekle" });
  }

  handleHarvestPlant(client: Client, plantId: string) {
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (!p || p.dead) return;
    const node = this.state.plants.get(plantId);
    if (!node) return;
    if (Math.hypot(p.pos.x - node.pos.x, p.pos.z - node.pos.z) > 2.5) {
      client.send("system", { text: "Önce bitkiye yaklaş" });
      return;
    }
    const stage = plantStage(node.plantedAt, Date.now());
    if (stage < 3) {
      client.send("system", { text: "Henüz tam olgunlaşmadı" });
      return;
    }
    const berryQty = 2 + Math.floor(Math.random() * 3);
    const seedQty = 1 + Math.floor(Math.random() * 2);
    this.addToInventory(p, "berry", berryQty);
    this.addToInventory(p, "berry_seed", seedQty);
    this.state.plants.delete(plantId);
    client.send("system", { text: `🌾 Hasat: 🫐 ×${berryQty} + 🌱 ×${seedQty}` });
    this.bumpAchievement(sid, "harvests");
  }

  handleFeedAnimal(client: Client, monsterId: string) {
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (!p || p.dead) return;
    let pets: any[] = [];
    try { pets = JSON.parse(p.petsJson || "[]"); } catch {}
    if (pets.length >= 8) {
      client.send("system", { text: "En fazla 8 hayvan besleyebilirsin — önce bazılarını serbest bırak" });
      return;
    }
    const m = this.state.monsters.get(monsterId);
    if (!m || m.dead) return;
    const cfg = (MONSTERS as any)[m.kind];
    if (!cfg || cfg.aggroRange !== -1) {
      client.send("system", { text: "Yalnızca evcil hayvanlar beslenebilir (tavuk/domuz/inek)" });
      return;
    }
    if (Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z) > 2.5) {
      client.send("system", { text: "Önce hayvana yaklaş" });
      return;
    }
    if (countItem(p, "berry") < 1) {
      client.send("system", { text: "Çilek yok" });
      return;
    }
    removeItem(p, "berry", 1);
    const key = sid + ":" + monsterId;
    const need = m.kind === "chicken" ? 3 : m.kind === "pig" ? 5 : 7;
    const cur = (this.tameProgress.get(key) ?? 0) + 1;
    if (cur >= need) {
      this.tameProgress.delete(key);
      const isRare = Math.random() < 0.05;
      const petId = "pet_" + Math.random().toString(36).slice(2, 8);
      pets.push({ id: petId, kind: m.kind, rare: isRare, tamedAt: Date.now() });
      p.petsJson = JSON.stringify(pets);
      if (!p.petKind) {
        p.petKind = m.kind;
        p.petRare = isRare;
      }
      m.dead = true;
      this.state.monsters.delete(monsterId);
      this.lastAttack.delete(monsterId);
      this.monsterSpawn.delete(monsterId);
      for (const k of this.statusTickAcc.keys()) if (k.endsWith(":" + monsterId)) this.statusTickAcc.delete(k);
      for (const k of this.tameProgress.keys()) if (k.endsWith(":" + monsterId)) this.tameProgress.delete(k);
      const rareText = isRare ? "✨ ÖZEL ✨ " : "";
      client.send("system", { text: `🎉 ${rareText}${cfg.name} evcil hayvan olarak yakalandı!` });
      this.bumpAchievement(sid, "tames");
    } else {
      this.tameProgress.set(key, cur);
      client.send("system", { text: `🌾 Besleme ${cur}/${need}` });
    }
  }
}