import { describe, expect, it } from 'vitest';
import { RARITIES, rarityChances, rollRarity } from '../data/rarity';
import { analyzeShot, effectiveArmor, penChance, resolveHit, ricochetChance } from '../game/armor';
import { baseTankStats } from '../data/tanks';
import { applyParts } from '../data/parts';
import { newProfile, grantStarterTanks, equipPart, tankStats } from './profile';
import { applyReward, rollRewards } from './rewards';
import { buyOffer, mulberry32, shopOffers, SHOP_WINDOW_MS } from './shop';

describe('rarity', () => {
  it('normalizes weights to 100%', () => {
    const c = rarityChances();
    const sum = RARITIES.reduce((s, r) => s + c[r], 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(c.poor).toBeCloseTo(15 / 56, 10);
    expect(c.divine).toBeCloseTo(2 / 56, 10);
  });
  it('rolls follow the weights', () => {
    const rand = mulberry32(42);
    const n = 56000;
    let divine = 0;
    for (let i = 0; i < n; i++) if (rollRarity(rand) === 'divine') divine++;
    expect(divine / n).toBeGreaterThan(0.03);
    expect(divine / n).toBeLessThan(0.042);
  });
});

describe('armor', () => {
  it('angled plates are thicker', () => {
    expect(effectiveArmor(100, 0)).toBeCloseTo(100);
    expect(effectiveArmor(100, 60)).toBeCloseTo(200);
  });
  it('pen chance is 0 / 0.5 / 1 at the edges', () => {
    expect(penChance(100, 130)).toBe(0);
    expect(penChance(100, 100)).toBeCloseTo(0.5);
    expect(penChance(100, 70)).toBe(1);
  });
  it('steep hits bounce, overmatch does not', () => {
    expect(ricochetChance(100, 100, 75, 0.3)).toBeGreaterThan(0.85);
    expect(ricochetChance(400, 100, 75, 0.3)).toBe(0);
    expect(ricochetChance(100, 100, 10, 0.9)).toBe(0);
  });
  it('resolveHit and analysis agree on sure pens', () => {
    const a = analyzeShot(300, 400, 50, 0, 0.1);
    expect(a.chance).toBe(1);
    expect(resolveHit(300, 400, 50, 0, 0.1, () => 0.5).result).toBe('pen');
    expect(resolveHit(50, 400, 200, 0, 0.1, () => 0.5).result).toBe('blocked');
  });
});

describe('stats', () => {
  it('nations keep their character', () => {
    const ussr = baseTankStats('ussr', 'heavy', 'common');
    const ger = baseTankStats('germany', 'heavy', 'common');
    const fr = baseTankStats('france', 'heavy', 'common');
    const uk = baseTankStats('uk', 'heavy', 'common');
    expect(ussr.hullArmor.front).toBeGreaterThan(ger.hullArmor.front);
    expect(ger.pen).toBeGreaterThan(ussr.pen);
    expect(fr.speed).toBeGreaterThan(ger.speed);
    expect(fr.magazine).toBeGreaterThan(1);
    expect(uk.reload).toBeLessThan(ger.reload);
  });
  it('rarity and parts make tanks stronger', () => {
    const c = baseTankStats('usa', 'mobile', 'common');
    const d = baseTankStats('usa', 'mobile', 'divine');
    expect(d.hp).toBeGreaterThan(c.hp);
    const withGun = applyParts(c, [{ id: 'x', nation: 'usa', slot: 'gun', rarity: 'epic' }]);
    expect(withGun.damage).toBeGreaterThan(c.damage);
    expect(withGun.reload).toBeLessThan(c.reload);
  });
  it('parts only fit tanks of their nation', () => {
    const p = newProfile();
    grantStarterTanks(p, 'germany');
    const t = p.tanks[0];
    p.parts.push({ id: 'a', nation: 'uk', slot: 'gun', rarity: 'rare' });
    equipPart(p, t, p.parts[0]);
    expect(t.equipped.gun).toBeUndefined();
    p.parts.push({ id: 'b', nation: 'germany', slot: 'gun', rarity: 'rare' });
    equipPart(p, t, p.parts[1]);
    expect(t.equipped.gun).toBe('b');
    expect(tankStats(p, t).damage).toBeGreaterThan(baseTankStats('germany', t.cls, 'common').damage);
  });
});

describe('rewards', () => {
  it('pays damage-based coins, double on win', () => {
    const never = () => 0.99;
    expect(rollRewards(true, 1000, never).coins).toBe(1000);
    expect(rollRewards(false, 1000, never).coins).toBe(500);
  });
  it('drop rates match the design', () => {
    const rand = mulberry32(7);
    const n = 20000;
    let wt = 0, wp = 0, lt = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const w = rollRewards(true, 0, rand);
      if (w.tank) wt++;
      if (w.part) wp++;
      const l = rollRewards(false, 0, rand);
      if (l.tank) lt++;
      if (l.part) lp++;
    }
    expect(wt / n).toBeCloseTo(0.1, 1);
    expect(wp / n).toBeCloseTo(0.15, 1);
    expect(lt / n).toBeCloseTo(0.05, 1);
    expect(lp / n).toBeCloseTo(0.1, 1);
  });
  it('duplicate tanks turn into coins', () => {
    const p = newProfile();
    grantStarterTanks(p, 'ussr');
    const before = p.tanks.length;
    const r = rollRewards(true, 0, () => 0.99);
    r.tank = { id: 'z', nation: 'ussr', cls: 'heavy', rarity: 'common', equipped: {} };
    applyReward(p, r);
    expect(p.tanks.length).toBe(before);
    expect(r.duplicateCoins).toBeGreaterThan(0);
  });
});

describe('shop', () => {
  it('has 5 offers that stay fixed within a 5-minute window', () => {
    const p = newProfile();
    const t0 = 1_000 * SHOP_WINDOW_MS + 10;
    const a = shopOffers(p, t0);
    const b = shopOffers(p, t0 + 60_000);
    const c = shopOffers(p, t0 + SHOP_WINDOW_MS);
    expect(a).toHaveLength(5);
    expect(a.map((o) => o.part.rarity + o.part.slot)).toEqual(b.map((o) => o.part.rarity + o.part.slot));
    expect(a.map((o) => o.part.id)).not.toEqual(c.map((o) => o.part.id));
  });
  it('buying costs coins and marks the offer sold', () => {
    const p = newProfile();
    p.coins = 100000;
    const t0 = 5 * SHOP_WINDOW_MS;
    const o = shopOffers(p, t0)[0];
    expect(buyOffer(p, o, t0)).toBe(true);
    expect(p.coins).toBe(100000 - o.price);
    expect(shopOffers(p, t0)[0].sold).toBe(true);
    expect(buyOffer(p, shopOffers(p, t0)[0], t0)).toBe(false);
  });
});
