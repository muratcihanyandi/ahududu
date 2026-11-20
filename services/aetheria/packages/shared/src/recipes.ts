// Crafting recipes — combine resources/materials into useful items.
// Recipes are validated server-side; client UI shows the list and lets you craft.

export type Recipe = {
  id: string;
  name: string;
  icon: string;
  category: "cooking" | "weapon" | "armor" | "potion";
  inputs: Array<{ itemId: string; qty: number }>;
  output: { itemId: string; qty: number };
  /** Minimum character level required */
  minLevel?: number;
  desc?: string;
  /** Minimum crafting bench tier required */
  minBenchTier?: number;
  /** Quality tier chances (bench bonus applied on top) */
  qualityChance?: {
    superior?: number;
    rare?: number;
    masterwork?: number;
    legendary?: number;
  };
  /** How this recipe is discovered */
  discoveryMethod?: "research" | "monster_drop" | "vendor" | "quest";
  /** Whether this recipe has been discovered by the player */
  discovered?: boolean;
};

export interface CraftingBench {
  id: string;
  name: string;
  nameTh: string;
  minTier: number; // 0=basic, 1=standard, 2=advanced, 3=master
  qualityBonus: number; // bonus to quality roll (0-0.4)
  speedBonus: number;   // craft time reduction (0-0.5)
}

export const CRAFTING_BENCHES: CraftingBench[] = [
  { id: "workbench",    name: "Workbench",    nameTh: "Tezgâh",    minTier: 0, qualityBonus: 0,    speedBonus: 0 },
  { id: "forge",        name: "Forge",        nameTh: "Ocak",           minTier: 1, qualityBonus: 0.1,  speedBonus: 0.1 },
  { id: "enchanter",    name: "Enchanter",    nameTh: "Büyü Tezgâhı",       minTier: 2, qualityBonus: 0.2,  speedBonus: 0.2 },
  { id: "master_forge", name: "Master Forge", nameTh: "Usta Ocağı",  minTier: 3, qualityBonus: 0.4,  speedBonus: 0.4 },
];

export const RECIPES: Recipe[] = [
  // ── COOKING ──
  {
    id: "recipe_cooked_meat",
    name: "Izgara Et",
    icon: "🍖",
    category: "cooking",
    inputs: [
      { itemId: "raw_meat", qty: 1 },
      { itemId: "wood_log", qty: 1 },
    ],
    output: { itemId: "cooked_meat", qty: 1 },
    desc: "Çiğ eti ateşte pişir — Tokluk+60, CP+15",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_cooked_fish",
    name: "Izgara Balık",
    icon: "🍣",
    category: "cooking",
    inputs: [
      { itemId: "raw_fish", qty: 1 },
      { itemId: "wood_log", qty: 1 },
    ],
    output: { itemId: "cooked_fish", qty: 1 },
    desc: "Balığı ateşte pişir — Tokluk+50, CP+10",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_bread",
    name: "Ekmek",
    icon: "🍞",
    category: "cooking",
    inputs: [
      { itemId: "berry", qty: 6 },
      { itemId: "wood_log", qty: 1 },
    ],
    output: { itemId: "bread", qty: 1 },
    desc: "Çileği öğüt ve pişir — Tokluk+40",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },

  // ── POTIONS ──
  {
    id: "recipe_hp_potion",
    name: "CP İksiri",
    icon: "🧪",
    category: "potion",
    inputs: [
      { itemId: "berry", qty: 4 },
      { itemId: "raw_meat", qty: 1 },
    ],
    output: { itemId: "hp_potion", qty: 1 },
    desc: "Çilek ve protein döv — CP+40",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_energy_tonic",
    name: "Enerji İksiri",
    icon: "⚡",
    category: "potion",
    inputs: [
      { itemId: "berry", qty: 5 },
      { itemId: "stone_chunk", qty: 1 },
    ],
    output: { itemId: "energy_tonic", qty: 1 },
    minLevel: 3,
    desc: "Dayanıklılık +100",
    minBenchTier: 1,
    qualityChance: { superior: 0.25, rare: 0.03 },
    discoveryMethod: "vendor",
    discovered: true,
  },

  // ── WEAPONS ──
  {
    id: "recipe_wood_axe",
    name: "Tahta Balta",
    icon: "🪓",
    category: "weapon",
    inputs: [{ itemId: "wood_log", qty: 3 }],
    output: { itemId: "wood_axe", qty: 1 },
    desc: "Ağaçları 3× daha hızlı keser",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_iron_pickaxe",
    name: "Demir Kazma",
    icon: "⛏",
    category: "weapon",
    inputs: [{ itemId: "wood_log", qty: 2 }, { itemId: "stone_chunk", qty: 4 }],
    output: { itemId: "iron_pickaxe", qty: 1 },
    minLevel: 2,
    desc: "Kaya/cevherleri 3× daha hızlı kırar",
    minBenchTier: 1,
    qualityChance: { superior: 0.25, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_wood_sword",
    name: "Tahta Kılıç",
    icon: "🗡",
    category: "weapon",
    inputs: [{ itemId: "wood_log", qty: 4 }],
    output: { itemId: "wood_sword", qty: 1 },
    desc: "Tahtayı sivrilt — +3 ATAK",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_iron_sword",
    name: "Demir Kılıç",
    icon: "⚔",
    category: "weapon",
    inputs: [
      { itemId: "wood_log", qty: 2 },
      { itemId: "stone_chunk", qty: 6 },
    ],
    output: { itemId: "iron_sword", qty: 1 },
    minLevel: 5,
    desc: "Demiri ahşap sap ile döv — +8 ATAK",
    minBenchTier: 1,
    qualityChance: { superior: 0.25, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },

  // ── ARMOR ──
  {
    id: "recipe_leather_armor",
    name: "Deri Zırh",
    icon: "🥋",
    category: "armor",
    inputs: [{ itemId: "raw_meat", qty: 6 }],
    output: { itemId: "leather_armor", qty: 1 },
    desc: "Hayvan derisini tabakla — +3 DEF",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  // ── FURNITURE ──
  {
    id: "recipe_furniture_bed",
    name: "Sevimli Yatak",
    icon: "🛏",
    category: "armor",
    inputs: [{ itemId: "wood_log", qty: 6 }, { itemId: "berry", qty: 4 }],
    output: { itemId: "furniture_bed", qty: 1 },
    desc: "Evine yerleştir",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_furniture_lamp",
    name: "Lamba",
    icon: "💡",
    category: "armor",
    inputs: [{ itemId: "wood_log", qty: 2 }, { itemId: "stone_chunk", qty: 1 }],
    output: { itemId: "furniture_lamp", qty: 1 },
    desc: "Geceyi aydınlatır",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_furniture_chair",
    name: "Sandalye",
    icon: "🪑",
    category: "armor",
    inputs: [{ itemId: "wood_log", qty: 4 }],
    output: { itemId: "furniture_chair", qty: 1 },
    desc: "Oturup dinlenebilirsin",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_furniture_plant",
    name: "Saksı Bitkisi",
    icon: "🪴",
    category: "armor",
    inputs: [{ itemId: "berry_seed", qty: 2 }, { itemId: "stone_chunk", qty: 1 }],
    output: { itemId: "furniture_plant", qty: 1 },
    desc: "Evine yeşil bir ferahlık",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  {
    id: "recipe_furniture_rug",
    name: "Halı",
    icon: "🧶",
    category: "armor",
    inputs: [{ itemId: "berry", qty: 8 }, { itemId: "wood_log", qty: 1 }],
    output: { itemId: "furniture_rug", qty: 1 },
    desc: "Zemini süsler",
    minBenchTier: 0,
    qualityChance: { superior: 0.3, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },

  {
    id: "recipe_iron_armor",
    name: "Demir Zırh",
    icon: "🛡",
    category: "armor",
    inputs: [
      { itemId: "stone_chunk", qty: 10 },
      { itemId: "wood_log", qty: 2 },
    ],
    output: { itemId: "iron_armor", qty: 1 },
    minLevel: 7,
    desc: "Metalden zırh döv — +8 DEF",
    minBenchTier: 1,
    qualityChance: { superior: 0.25, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  // ── MP POTION (brewed from berry + crystal) ──
  {
    id: "recipe_mp_potion",
    name: "MP İksiri",
    icon: "💙",
    category: "potion",
    inputs: [
      { itemId: "berry", qty: 3 },
      { itemId: "crystal", qty: 1 },
    ],
    output: { itemId: "mp_potion", qty: 2 },
    desc: "Çilek + kristal → MP doldurur",
    minLevel: 5,
    minBenchTier: 1,
    qualityChance: { superior: 0.25, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  // ── ENERGY TONIC v2 (from cooked meat + berry — alternate ingredients) ──
  {
    id: "recipe_energy_tonic_meat",
    name: "Enerji İksiri (Etli)",
    icon: "⚡",
    category: "potion",
    inputs: [
      { itemId: "cooked_meat", qty: 1 },
      { itemId: "berry", qty: 2 },
    ],
    output: { itemId: "energy_tonic", qty: 1 },
    desc: "Izgara et + çilek → dayanıklılığı tamamen yeniler",
    minBenchTier: 1,
    qualityChance: { superior: 0.25, rare: 0.03 },
    discoveryMethod: "vendor",
    discovered: true,
  },
  // ── HP POTION v2 (cooked fish + crystal — alternate, Lv5 unlock) ──
  {
    id: "recipe_hp_potion_fish",
    name: "CP İksiri (Balıklı)",
    icon: "🧪",
    category: "potion",
    inputs: [
      { itemId: "cooked_fish", qty: 1 },
      { itemId: "crystal", qty: 1 },
    ],
    output: { itemId: "hp_potion", qty: 2 },
    desc: "Izgara balık + kristal → CP doldurur",
    minLevel: 5,
    minBenchTier: 1,
    qualityChance: { superior: 0.25, rare: 0.05 },
    discoveryMethod: "vendor",
    discovered: true,
  },
];

export const RECIPES_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
