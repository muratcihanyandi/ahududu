// Lightweight achievement / milestone tracker.
// Server keeps counters as a JSON blob per character; client renders progress.

export type AchievementDef = {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** Counter key in player's progress object */
  counter: string;
  goal: number;
  /** Reward when first reaches goal */
  reward?: { zeny?: number; itemId?: string; qty?: number };
  /** Title unlocked along with the achievement */
  title?: string;
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_kill",   icon: "🗡",  name: "Çaylak Kahraman",  desc: "İlk canavarını öldür",          counter: "kills",       goal: 1,    reward: { zeny: 50 }, title: "Çaylak Kahraman" },
  { id: "warrior",      icon: "⚔",   name: "Savaşçı",         desc: "50 canavar öldür",         counter: "kills",       goal: 50,   reward: { zeny: 500, itemId: "hp_potion", qty: 5 }, title: "Savaşçı" },
  { id: "champion",     icon: "🏆",  name: "Şampiyon",         desc: "200 canavar öldür",        counter: "kills",       goal: 200,  reward: { zeny: 2000, itemId: "hp_potion", qty: 15 }, title: "🏆 Şampiyon" },
  { id: "lumberjack",   icon: "🪵",  name: "Oduncu",       desc: "30 ağaç kes",              counter: "trees",       goal: 30,   reward: { zeny: 200 }, title: "🪵 Ağaç Kesici" },
  { id: "miner",        icon: "⛏",   name: "Madenci",  desc: "20 kaya/cevher kır",             counter: "rocks",       goal: 20,   reward: { zeny: 300 }, title: "⛏ Maden Ustası" },
  { id: "angler",       icon: "🎣",  name: "Balıkçı",      desc: "20 balık tut",                  counter: "fishes",      goal: 20,   reward: { itemId: "rare_fish", qty: 2 }, title: "🎣 Balıkçı Ustası" },
  { id: "chef",         icon: "🍞",  name: "Aşçı",          desc: "10 yemek üret",            counter: "cooks",       goal: 10,   reward: { itemId: "cooked_meat", qty: 5 }, title: "👨‍🍳 Aşçı" },
  { id: "smith",        icon: "🔨",  name: "Demirci",   desc: "10 silah/zırh üret",        counter: "smiths",      goal: 10,   reward: { zeny: 500 }, title: "🔨 Demirci" },
  { id: "homeowner",    icon: "🏠",  name: "Ev Sahibi",   desc: "Bir ev inşa et",                       counter: "house",       goal: 1,    reward: { zeny: 200 }, title: "🏠 Ev Sahibi" },
  { id: "tamer",        icon: "🐎",  name: "Evcilleştirici", desc: "3 evcil hayvan yakala",          counter: "tames",       goal: 3,    reward: { itemId: "berry", qty: 20 }, title: "🐾 Hayvan Terbiyecisi" },
  { id: "farmer",       icon: "🌾",  name: "Bahçıvan",        desc: "10 ürün hasat et",           counter: "harvests",    goal: 10,   reward: { itemId: "berry_seed", qty: 10 }, title: "🌾 Bahçıvan" },
  { id: "explorer",     icon: "🗺",  name: "Maceracı",     desc: "5 bölgeyi ziyaret et",                  counter: "biomes",      goal: 5,    reward: { zeny: 300 }, title: "🗺 Maceracı" },
  { id: "darklord",     icon: "⚜",   name: "Gölge Fatihi",   desc: "Dark Lord'u yen",                   counter: "darklord",    goal: 1,    reward: { zeny: 5000, itemId: "blade_of_dawn", qty: 1 }, title: "⚜ Gölge Fatihi" },
  // ── Cave-clear chain — kill the boss inside each cave ─────────────────────
  { id: "cave_shadow_clear",     icon: "🕳", name: "Gölge Mağarası fethedildi",       desc: "Gölge Mağarası'nın patronunu yen",       counter: "cave_shadow",     goal: 1, reward: { zeny: 200, itemId: "dark_crystal", qty: 1 }, title: "🕳 Gölge Fatihi" },
  { id: "cave_frost_clear",      icon: "❄", name: "Buz Mağarası fethedildi",   desc: "Buz Mağarası'nın patronunu yen",    counter: "cave_frost",      goal: 1, reward: { zeny: 200, itemId: "ice_crystal", qty: 1 }, title: "❄ Buz Fatihi" },
  { id: "cave_desert_clear",     icon: "🏜", name: "Çöl Mağarası fethedildi",  desc: "Çöl Mağarası'nın patronunu yen",   counter: "cave_desert",     goal: 1, reward: { zeny: 200, itemId: "desert_pearl", qty: 1 }, title: "🏜 Kum Fatihi" },
  { id: "cave_swamp_clear",      icon: "🐍", name: "Bataklık Mağarası fethedildi",     desc: "Bataklık Mağarası'nın patronunu yen",    counter: "cave_swamp",      goal: 1, reward: { zeny: 200, itemId: "swamp_herb", qty: 3 }, title: "🐍 Bataklık Fatihi" },
  { id: "cave_forest_clear",     icon: "🌲", name: "Derin Orman Mağarası fethedildi",     desc: "Orman mağarasındaki orkları temizle",  counter: "cave_forest",     goal: 5, reward: { zeny: 200, itemId: "orc_tusk", qty: 3 }, title: "🌲 Orman Fatihi" },
  { id: "cave_wilderness_clear", icon: "⚜", name: "Muhafız Mağarası fethedildi", desc: "Mağarada Dark Lord'u yen",  counter: "cave_wilderness", goal: 1, reward: { zeny: 500, itemId: "recall_stone", qty: 3 }, title: "⚜ Vahşi Doğa Fatihi" },
  { id: "cave_master",           icon: "👑", name: "Mağaraların Efendisi",             desc: "6 mağaranın hepsini temizle",       counter: "caves_cleared",   goal: 6, reward: { zeny: 5000, itemId: "warp_stone", qty: 1 }, title: "👑 Mağara Ustası" },
];

export type AchievementProgress = {
  counters: Record<string, number>;
  unlocked: string[]; // achievement ids
};

export const emptyAchievementProgress = (): AchievementProgress => ({ counters: {}, unlocked: [] });
