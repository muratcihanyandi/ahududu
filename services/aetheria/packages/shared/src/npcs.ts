import type { MapId } from "./maps.js";

export type NpcKind = "shop" | "quest" | "warp" | "info";

export type ShopEntry = { itemId: string; price: number };

export type NpcDef = {
  id: string;
  name: string;
  kind: NpcKind;
  mapId: MapId;
  x: number;
  z: number;
  color: string;
  icon: string;
  dialog: string;
  shop?: ShopEntry[];
  /** Optional branching dialog choices, rendered above the default
   *  Buy/Sell/Quests tabs. Each choice can have requires to gate visibility. */
  choices?: NpcChoice[];
};

/** A single branching dialog button on an NPC. */
export type NpcChoice = {
  text: string;
  requires?: {
    minLevel?: number;
    questActive?: string;
    questCompleted?: string;
    minZeny?: number;
  };
  action:
    | { kind: "system"; text: string }
    | { kind: "acceptQuest"; questId: string }
    | { kind: "warp"; mapId: string }
    | { kind: "close" };
};

export const SELL_RATIO = 0.5; // shops buy items at 50% sell price

export const NPCS: NpcDef[] = [
  {
    id: "tutor_field",
    name: "Rehber Sera",
    kind: "info",
    mapId: "field",
    x: 0, z: -4,
    color: "#22d3ee",
    icon: "🎓",
    dialog: "Aetheria'ya hoş geldin!",
    choices: [
      { text: "🗺 Nasıl yürünür + saldırılır", action: { kind: "system", text: "Yürümek için WASD/ok tuşları · canavara tıkla ve saldırmak için Space bas · çantayı açmak için I bas" } },
      { text: "⚔ Meslek değiştirme", action: { kind: "system", text: "Sv10'da Swordsman/Mage/Archer/Acolyte/Thief arasından seçim açılır · Sv30'da 2. sınıf · Sv50'de 3. sınıf" }, requires: { minLevel: 5 } },
      { text: "💰 Nasıl para kazanılır?", action: { kind: "system", text: "Canavar avlayıp eşya sat → Tüccar Mira'ya git · Görev yap → ❗ NPC ile konuş · Çilek/Tahta toplayıp sat" } },
    ],
  },
  {
    id: "carpenter_field",
    name: "Marangoz Bren",
    kind: "info",
    mapId: "field",
    x: 4, z: 3,
    color: "#a16207",
    icon: "🔨",
    dialog: "Bir evin olsun ister misin? Gerekli: 🪵 20 tahta + 🪨 10 taş + 💰 500 zeny",
  },
  {
    id: "merchant_field",
    name: "Merchant Mira",
    kind: "shop",
    mapId: "field",
    x: -5, z: -2,
    color: "#f59e0b",
    icon: "🛒",
    dialog: "Welcome traveler! Need supplies?",
    choices: [
      { text: "💎 Özel bir şeyin var mı?", action: { kind: "system", text: "Nadir eşyalar Açık Artırma Evi'nden bulunur — menüdeki 🏛 simgesine bas" } },
      { text: "🔥 VIP olup %10 indirim istiyorum", action: { kind: "system", text: "Üyelik için 5000z gerekli... ama şu an hizmete açık değil!" }, requires: { minZeny: 5000 } },
    ],
    shop: [
      { itemId: "hp_potion",     price: 50 },
      { itemId: "wood_sword",    price: 200 },
      { itemId: "leather_armor", price: 300 },
      { itemId: "iron_sword",    price: 1500 },
      { itemId: "iron_armor",    price: 2200 },
      { itemId: "recall_stone",  price: 500 },
    ],
  },
  {
    id: "scholar_field",
    name: "Scholar Reni",
    kind: "info",
    mapId: "field",
    x: 4, z: -3,
    color: "#a78bfa",
    icon: "📚",
    dialog: "The dungeon to the east hides stronger foes. Bring a healer!",
    choices: [
      { text: "📖 Aetheria'nın hikâyesi", action: { kind: "system", text: "Çok uzun zaman önce bu toprakları Dark Lord yönetirdi. Şimdi yaklaşık 10 dakikada bir geri dönüyor — hazır ol!" } },
      { text: "🏰 Gölge Zindanı", action: { kind: "system", text: "Doğudaki Shadow Portal'ı kullan · Sv 25+ gerekli · her 10 katta patron var" }, requires: { minLevel: 10 } },
      { text: "💍 Nasıl evlenilir?", action: { kind: "system", text: "Dükkândan wedding_ring al · başka bir oyuncuya kullanarak teklif et · ikiniz de Sv 20+ olmalısınız" }, requires: { minLevel: 15 } },
    ],
  },
  {
    id: "guard_dungeon",
    name: "Dungeon Guard",
    kind: "info",
    mapId: "dungeon",
    x: -16, z: 2,
    color: "#94a3b8",
    icon: "🛡",
    dialog: "Careful in there. The boss only appears every so often.",
  },
  {
    id: "blacksmith_field",
    name: "Blacksmith Forge",
    kind: "info",
    mapId: "field",
    x: 6, z: 1,
    color: "#f97316",
    icon: "⚒️",
    dialog: "Tahtayla büyü yapılmaz — ama güçlendirilir! Çantandaki silah/zırhı seç, +1 stat için 500z öde",
  },
{
    id: "waypoint_npc_field",
    name: "Waypoint Keeper",
    kind: "info",
    mapId: "field",
    x: -2, z: 3,
    color: "#22d3ee",
    icon: "🏛️",
    dialog: "Uzun yol zahmetli mi? 50z öde ve işaretine ışınlan! (Haritayı açmak için M)",
  },
  {
    id: "cave_guide",
    name: "Mağara Rehberi Jen",
    kind: "info",
    mapId: "field",
    x: 0, z: -8,
    color: "#7c3aed",
    icon: "🗺",
    dialog: "Farklı yönlere yürüdüğünde doğrudan girebileceğin mağaralar bulacaksın — portal gerekmez!",
    choices: [
      { text: "🕳 Gölge Mağarası (KB, Sv 10+)",       action: { kind: "system", text: "Kuzeybatı, koordinat (-80, -60) — kurtlar + orklar" } },
      { text: "❄ Buz Mağarası (KB, Sv 20+)",    action: { kind: "system", text: "Gölge Mağarası'nın kuzeyi, koordinat (-75, -80) — yeti + buz hayaleti + dev kardan adam" } },
      { text: "🏜 Çöl Mağarası (KB, Sv 25+)",   action: { kind: "system", text: "Koordinat (-55, -85) — kum solucanı + akrep lordu" } },
      { text: "🌿 Bataklık Mağarası (G, Sv 30+)",      action: { kind: "system", text: "Güney, koordinat (0, 85) — dere cadısı + dev zehirli yılan" } },
      { text: "🌲 Derin Orman Mağarası (KD, Sv 20+)",     action: { kind: "system", text: "Koordinat (78, -60) — büyük ork yuvası" } },
      { text: "⚜ Muhafız Mağarası (K, Sv 40+)",   action: { kind: "system", text: "En kuzey, koordinat (0, -90) — Dark Lord seni bekliyor!" }, requires: { minLevel: 30 } },
    ],
  },
];
