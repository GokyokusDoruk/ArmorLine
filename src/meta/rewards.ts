import { RARITY_INFO } from '../data/rarity';
import type { Part } from '../data/parts';
import { randomPart, randomTank, type OwnedTank, type Profile } from './profile';

export const DROP_CHANCE = {
  tank: { win: 0.1, loss: 0.05 },
  part: { win: 0.15, loss: 0.1 },
};

/** Coins per point of damage dealt. Wins pay double. */
export const COINS_PER_DAMAGE = 0.5;

export interface BattleReward {
  win: boolean;
  damage: number;
  coins: number;
  tank?: OwnedTank;
  /** Set when the dropped tank was a duplicate and got converted to coins. */
  duplicateCoins?: number;
  part?: Part;
}

export function rollRewards(win: boolean, damage: number, rand: () => number = Math.random): BattleReward {
  const coins = Math.round(damage * COINS_PER_DAMAGE * (win ? 2 : 1));
  const r: BattleReward = { win, damage, coins };
  if (rand() < (win ? DROP_CHANCE.tank.win : DROP_CHANCE.tank.loss)) r.tank = randomTank(rand);
  if (rand() < (win ? DROP_CHANCE.part.win : DROP_CHANCE.part.loss)) r.part = randomPart(rand);
  return r;
}

/** Applies a reward to the profile. Exact duplicate tanks become coins. */
export function applyReward(p: Profile, r: BattleReward): void {
  p.coins += r.coins;
  p.stats.battles += 1;
  if (r.win) p.stats.wins += 1;
  p.stats.damage += r.damage;
  if (r.tank) {
    const t = r.tank;
    const dup = p.tanks.some((x) => x.nation === t.nation && x.cls === t.cls && x.rarity === t.rarity);
    if (dup) {
      r.duplicateCoins = RARITY_INFO[t.rarity].price;
      p.coins += r.duplicateCoins;
    } else {
      p.tanks.push(t);
    }
  }
  if (r.part) p.parts.push(r.part);
}
