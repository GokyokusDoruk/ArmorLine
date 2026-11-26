export const RARITIES = [
  'poor',
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
  'divine',
] as const;

export type Rarity = (typeof RARITIES)[number];

export interface RarityInfo {
  id: Rarity;
  name: string;
  color: string;
  /** Raw drop weight from the design (normalized to 100% when rolling). */
  weight: number;
  /** Multiplier on a tank's core stats. */
  tankMult: number;
  /** Percent bonus a part of this rarity gives to each of its stats. */
  partBonus: number;
  /** Shop price of a part of this rarity. */
  price: number;
}

export const RARITY_INFO: Record<Rarity, RarityInfo> = {
  poor: { id: 'poor', name: 'Poor', color: '#9aa0a6', weight: 15, tankMult: 0.9, partBonus: 0.03, price: 250 },
  common: { id: 'common', name: 'Common', color: '#f2f4f7', weight: 12, tankMult: 1.0, partBonus: 0.05, price: 500 },
  uncommon: { id: 'uncommon', name: 'Uncommon', color: '#3ddc6a', weight: 9, tankMult: 1.06, partBonus: 0.08, price: 1000 },
  rare: { id: 'rare', name: 'Rare', color: '#3a8bff', weight: 6, tankMult: 1.12, partBonus: 0.11, price: 2000 },
  epic: { id: 'epic', name: 'Epic', color: '#b05cff', weight: 5, tankMult: 1.18, partBonus: 0.15, price: 4000 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ffc531', weight: 4, tankMult: 1.25, partBonus: 0.19, price: 8000 },
  mythic: { id: 'mythic', name: 'Mythic', color: '#ff3b3b', weight: 3, tankMult: 1.32, partBonus: 0.24, price: 15000 },
  divine: { id: 'divine', name: 'Divine', color: 'rainbow', weight: 2, tankMult: 1.4, partBonus: 0.3, price: 30000 },
};

export function rarityIndex(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/** Normalized drop chance (0..1) of each rarity. */
export function rarityChances(): Record<Rarity, number> {
  const total = RARITIES.reduce((s, r) => s + RARITY_INFO[r].weight, 0);
  const out = {} as Record<Rarity, number>;
  for (const r of RARITIES) out[r] = RARITY_INFO[r].weight / total;
  return out;
}

export function rollRarity(rand: () => number = Math.random): Rarity {
  const chances = rarityChances();
  let x = rand();
  for (const r of RARITIES) {
    x -= chances[r];
    if (x < 0) return r;
  }
  return 'poor';
}

/** CSS color for UI; divine gets a gradient. */
export function rarityCss(r: Rarity): string {
  return r === 'divine'
    ? 'linear-gradient(90deg,#ff3b3b,#ffc531,#3ddc6a,#33d6ff,#b05cff)'
    : RARITY_INFO[r].color;
}
