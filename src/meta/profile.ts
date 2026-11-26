import { RARITY_INFO, rollRarity, type Rarity } from '../data/rarity';
import { CLASSES, NATIONS, baseTankStats, type Nation, type TankClass, type TankStats } from '../data/tanks';
import { SLOTS, applyParts, type Part, type Slot } from '../data/parts';

export interface OwnedTank {
  id: string;
  nation: Nation;
  cls: TankClass;
  rarity: Rarity;
  equipped: Partial<Record<Slot, string>>;
}

export interface Profile {
  version: 1;
  coins: number;
  tanks: OwnedTank[];
  parts: Part[];
  selectedTankId: string | null;
  shopBought: { window: number; indices: number[] };
  stats: { battles: number; wins: number; damage: number };
}

const KEY = 'armorline.profile.v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newProfile(): Profile {
  return {
    version: 1,
    coins: 500,
    tanks: [],
    parts: [],
    selectedTankId: null,
    shopBought: { window: -1, indices: [] },
    stats: { battles: 0, wins: 0, damage: 0 },
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      if (p && p.version === 1 && Array.isArray(p.tanks)) return p;
    }
  } catch {
    /* corrupted save: start fresh */
  }
  return newProfile();
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: keep playing in memory */
  }
}

export function resetProfile(): Profile {
  localStorage.removeItem(KEY);
  return newProfile();
}

/** Gives the 4 common tanks of the chosen starting nation. */
export function grantStarterTanks(p: Profile, nation: Nation): void {
  for (const cls of CLASSES) {
    p.tanks.push({ id: uid(), nation, cls, rarity: 'common', equipped: {} });
  }
  p.selectedTankId = p.tanks[0].id;
}

export function selectedTank(p: Profile): OwnedTank | undefined {
  return p.tanks.find((t) => t.id === p.selectedTankId) ?? p.tanks[0];
}

export function equippedParts(p: Profile, t: OwnedTank): Part[] {
  const out: Part[] = [];
  for (const s of SLOTS) {
    const id = t.equipped[s];
    const part = id ? p.parts.find((x) => x.id === id) : undefined;
    if (part) out.push(part);
  }
  return out;
}

export function tankStats(p: Profile, t: OwnedTank): TankStats {
  return applyParts(baseTankStats(t.nation, t.cls, t.rarity), equippedParts(p, t));
}

/** Which tank (if any) has this part equipped. */
export function partOwner(p: Profile, partId: string): OwnedTank | undefined {
  return p.tanks.find((t) => Object.values(t.equipped).includes(partId));
}

export function equipPart(p: Profile, t: OwnedTank, part: Part): void {
  if (part.nation !== t.nation) return;
  const prev = partOwner(p, part.id);
  if (prev) delete prev.equipped[part.slot];
  t.equipped[part.slot] = part.id;
}

export function unequipSlot(t: OwnedTank, slot: Slot): void {
  delete t.equipped[slot];
}

/** Sell value of a part: 40% of its shop price. */
export function sellValue(r: Rarity): number {
  return Math.round(RARITY_INFO[r].price * 0.4);
}

export function sellPart(p: Profile, partId: string): number {
  const part = p.parts.find((x) => x.id === partId);
  if (!part) return 0;
  const owner = partOwner(p, partId);
  if (owner) delete owner.equipped[part.slot];
  p.parts = p.parts.filter((x) => x.id !== partId);
  const v = sellValue(part.rarity);
  p.coins += v;
  return v;
}

export function randomPart(rand: () => number = Math.random): Part {
  return {
    id: uid(),
    nation: NATIONS[Math.floor(rand() * NATIONS.length)],
    slot: SLOTS[Math.floor(rand() * SLOTS.length)],
    rarity: rollRarity(rand),
  };
}

export function randomTank(rand: () => number = Math.random): OwnedTank {
  return {
    id: uid(),
    nation: NATIONS[Math.floor(rand() * NATIONS.length)],
    cls: CLASSES[Math.floor(rand() * CLASSES.length)],
    rarity: rollRarity(rand),
    equipped: {},
  };
}
