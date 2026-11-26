import { RARITY_INFO } from '../data/rarity';
import type { Part } from '../data/parts';
import { randomPart, uid, type Profile } from './profile';

export const SHOP_WINDOW_MS = 5 * 60 * 1000;
export const SHOP_SIZE = 5;

export interface ShopOffer {
  index: number;
  part: Part;
  price: number;
  sold: boolean;
}

/** Small deterministic PRNG so every player sees the same rotation in a window. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shopWindow(now: number = Date.now()): number {
  return Math.floor(now / SHOP_WINDOW_MS);
}

export function msUntilRefresh(now: number = Date.now()): number {
  return SHOP_WINDOW_MS - (now % SHOP_WINDOW_MS);
}

export function shopOffers(p: Profile, now: number = Date.now()): ShopOffer[] {
  const w = shopWindow(now);
  const rand = mulberry32(w * 2654435761);
  const bought = p.shopBought.window === w ? p.shopBought.indices : [];
  const out: ShopOffer[] = [];
  for (let i = 0; i < SHOP_SIZE; i++) {
    const part = randomPart(rand);
    part.id = `shop-${w}-${i}`;
    out.push({ index: i, part, price: RARITY_INFO[part.rarity].price, sold: bought.includes(i) });
  }
  return out;
}

export function buyOffer(p: Profile, offer: ShopOffer, now: number = Date.now()): boolean {
  const w = shopWindow(now);
  if (p.shopBought.window !== w) p.shopBought = { window: w, indices: [] };
  if (offer.sold || p.shopBought.indices.includes(offer.index)) return false;
  if (p.coins < offer.price) return false;
  p.coins -= offer.price;
  p.shopBought.indices.push(offer.index);
  p.parts.push({ ...offer.part, id: uid() });
  return true;
}
