import { RARITY_INFO, type Rarity } from './rarity';

export const NATIONS = ['ussr', 'germany', 'usa', 'uk', 'france'] as const;
export type Nation = (typeof NATIONS)[number];

export const CLASSES = ['heavy', 'mobile', 'sniper', 'artillery'] as const;
export type TankClass = (typeof CLASSES)[number];

export interface NationInfo {
  id: Nation;
  name: string;
  flag: string;
  /** Paint colors: body, accent. */
  colors: [number, number];
  traits: string[];
}

export const NATION_INFO: Record<Nation, NationInfo> = {
  ussr: {
    id: 'ussr',
    name: 'SSCB',
    flag: '☭',
    colors: [0x4f6b3a, 0xd23b2f],
    traits: ['İyi sektirme', 'Kalın zırh', 'İyi hasar', 'İyi can', 'Kötü delicilik', 'Kötü mobilite', 'Kötü spot'],
  },
  germany: {
    id: 'germany',
    name: 'Almanya',
    flag: '✠',
    colors: [0x5d6266, 0xe0b23a],
    traits: ['İyi delicilik', 'İyi isabet', 'Orta hasar', 'Orta zırh', 'Orta sektirme', 'Orta mobilite', 'Orta can', 'Kötü spot'],
  },
  usa: {
    id: 'usa',
    name: 'ABD',
    flag: '★',
    colors: [0x5a6a3c, 0x3a8bff],
    traits: ['Sağlam taret', 'İyi top eğilmesi', 'İyi spot', 'Orta hasar', 'Orta delicilik', 'Orta mobilite', 'Orta can', 'Zayıf gövde zırhı'],
  },
  uk: {
    id: 'uk',
    name: 'İngiltere',
    flag: '♛',
    colors: [0x8a7d55, 0xc8102e],
    traits: ['Çok hızlı dolum', 'İyi delicilik', 'İyi isabet', 'Sağlam taret', 'Orta can', 'Düşük tekil hasar', 'Zayıf gövde zırhı', 'Kötü mobilite'],
  },
  france: {
    id: 'france',
    name: 'Fransa',
    flag: '⚜',
    colors: [0x3e5a6e, 0x33d6ff],
    traits: ['Çok iyi mobilite', 'Şarjörlü top', 'İyi spot', 'Zayıf zırh', 'Kötü sektirme', 'Uzun şarjör dolumu', 'Düşük can'],
  },
};

export interface ClassInfo {
  id: TankClass;
  name: string;
  short: string;
  role: string;
}

export const CLASS_INFO: Record<TankClass, ClassInfo> = {
  heavy: { id: 'heavy', name: 'Tank', short: 'TNK', role: 'Canı yüksek, ön safta savaşır.' },
  mobile: { id: 'mobile', name: 'Mobil', short: 'MOB', role: 'Hızlıdır, rakipleri takımına gösterir.' },
  sniper: { id: 'sniper', name: 'Sniper', short: 'SNP', role: 'Hasarı yüksek; canı ve hareketi çok az.' },
  artillery: { id: 'artillery', name: 'Artillery', short: 'ART', role: 'Uzaktan kavisli atış; canı ve hareketi az.' },
};

/** Model names: [nation][class]. */
export const TANK_NAMES: Record<Nation, Record<TankClass, string>> = {
  ussr: { heavy: 'Medved', mobile: 'Strela', sniper: 'Sokol', artillery: 'Grom' },
  germany: { heavy: 'Bollwerk', mobile: 'Blitz', sniper: 'Adler', artillery: 'Donner' },
  usa: { heavy: 'Ironside', mobile: 'Coyote', sniper: 'Hawkeye', artillery: 'Liberty' },
  uk: { heavy: 'Bastion', mobile: 'Fox', sniper: 'Longbow', artillery: 'Thunderer' },
  france: { heavy: 'Rempart', mobile: 'Éclair', sniper: 'Faucon', artillery: 'Tonnerre' },
};

export interface ArmorSet {
  front: number;
  side: number;
  rear: number;
}

export interface TankStats {
  hp: number;
  damage: number;
  pen: number;
  /** Seconds between shots (or to refill the magazine for clip guns). */
  reload: number;
  magazine: number;
  /** Seconds between shots inside a magazine. */
  clipInterval: number;
  hullArmor: ArmorSet;
  turretArmor: ArmorSet;
  /** 0..1, chance multiplier for ricochets at steep angles. */
  ricochet: number;
  /** Units per second. */
  speed: number;
  accel: number;
  /** Degrees per second. */
  hullTraverse: number;
  turretTraverse: number;
  /** Spotting range in units. */
  view: number;
  /** Dispersion at full aim, in radians. */
  dispersion: number;
  /** Seconds to fully aim. */
  aimTime: number;
  zoom: number;
  gunDepression: number;
  gunElevation: number;
  shellSpeed: number;
  /** HE splash radius (artillery), 0 = none. */
  splash: number;
  /** Optic quality: 0 = no optic, 1..8 = poor..divine. Higher = more accurate pen/damage estimate. */
  opticLevel: number;
  /** Multiplier on damage dealt when ramming with the front. */
  ramPower: number;
  /** Extra ricochet chance on front hull hits (Front Armor part). */
  frontRicochet: number;
  /** Mass factor used for ramming and wall impacts. */
  mass: number;
  /** Electric shield: max share of damage it can stop when fully charged (0 = no shield). */
  shieldPower: number;
}

const BASE: Record<TankClass, Omit<TankStats, 'shieldPower'>> = {
  heavy: {
    hp: 2000, damage: 320, pen: 190, reload: 6.5, magazine: 1, clipInterval: 0,
    hullArmor: { front: 160, side: 95, rear: 60 },
    turretArmor: { front: 190, side: 110, rear: 70 },
    ricochet: 0.3, speed: 9, accel: 7, hullTraverse: 38, turretTraverse: 42,
    view: 55, dispersion: 0.012, aimTime: 2.3, zoom: 1.6,
    gunDepression: 7, gunElevation: 18, shellSpeed: 170, splash: 0, opticLevel: 0, ramPower: 1, frontRicochet: 0, mass: 1.5,
  },
  mobile: {
    hp: 1100, damage: 170, pen: 135, reload: 3.6, magazine: 1, clipInterval: 0,
    hullArmor: { front: 55, side: 38, rear: 25 },
    turretArmor: { front: 65, side: 40, rear: 28 },
    ricochet: 0.12, speed: 18, accel: 11, hullTraverse: 70, turretTraverse: 75,
    view: 82, dispersion: 0.02, aimTime: 1.7, zoom: 1.5,
    gunDepression: 8, gunElevation: 20, shellSpeed: 160, splash: 0, opticLevel: 0, ramPower: 1, frontRicochet: 0, mass: 0.8,
  },
  sniper: {
    hp: 850, damage: 470, pen: 265, reload: 8, magazine: 1, clipInterval: 0,
    hullArmor: { front: 45, side: 28, rear: 20 },
    turretArmor: { front: 50, side: 30, rear: 20 },
    ricochet: 0.08, speed: 7.5, accel: 3.5, hullTraverse: 30, turretTraverse: 30,
    view: 68, dispersion: 0.005, aimTime: 2.8, zoom: 3.2,
    gunDepression: 9, gunElevation: 15, shellSpeed: 260, splash: 0, opticLevel: 0, ramPower: 1, frontRicochet: 0, mass: 0.9,
  },
  artillery: {
    hp: 800, damage: 560, pen: 85, reload: 12, magazine: 1, clipInterval: 0,
    hullArmor: { front: 30, side: 20, rear: 15 },
    turretArmor: { front: 30, side: 20, rear: 15 },
    ricochet: 0.05, speed: 7, accel: 3, hullTraverse: 26, turretTraverse: 26,
    view: 45, dispersion: 0.035, aimTime: 3.5, zoom: 1,
    gunDepression: 5, gunElevation: 60, shellSpeed: 80, splash: 7, opticLevel: 0, ramPower: 1, frontRicochet: 0, mass: 0.9,
  },
};

/** Nation multipliers. 1 = medium; >1 better (for reload/dispersion we invert below). */
interface NationMods {
  hp: number;
  damage: number;
  pen: number;
  reload: number; // multiplier on reload time (lower is better)
  hullArmor: number;
  turretArmor: number;
  ricochet: number;
  mobility: number;
  view: number;
  accuracy: number; // multiplier on dispersion & aim time (lower is better)
  gunDepression: number;
}

const NATION_MODS: Record<Nation, NationMods> = {
  ussr: { hp: 1.2, damage: 1.2, pen: 0.85, reload: 1.05, hullArmor: 1.25, turretArmor: 1.25, ricochet: 1.5, mobility: 0.85, view: 0.85, accuracy: 1.15, gunDepression: 0.6 },
  germany: { hp: 1.0, damage: 1.0, pen: 1.2, reload: 1.0, hullArmor: 1.0, turretArmor: 1.0, ricochet: 1.0, mobility: 1.0, view: 0.85, accuracy: 0.8, gunDepression: 1.0 },
  usa: { hp: 1.0, damage: 1.0, pen: 1.0, reload: 1.0, hullArmor: 0.8, turretArmor: 1.35, ricochet: 1.0, mobility: 1.0, view: 1.2, accuracy: 1.0, gunDepression: 1.6 },
  uk: { hp: 1.0, damage: 0.75, pen: 1.2, reload: 0.62, hullArmor: 0.8, turretArmor: 1.3, ricochet: 1.0, mobility: 0.85, view: 1.0, accuracy: 0.8, gunDepression: 1.2 },
  france: { hp: 0.8, damage: 0.8, pen: 1.0, reload: 1.0, hullArmor: 0.7, turretArmor: 0.7, ricochet: 0.55, mobility: 1.35, view: 1.2, accuracy: 1.0, gunDepression: 1.0 },
};

function scaleArmor(a: ArmorSet, m: number): ArmorSet {
  return { front: a.front * m, side: a.side * m, rear: a.rear * m };
}

/** Stats of a bare tank (no parts) for a nation, class and rarity. */
export function baseTankStats(nation: Nation, cls: TankClass, rarity: Rarity): TankStats {
  const b = BASE[cls];
  const n = NATION_MODS[nation];
  const r = RARITY_INFO[rarity].tankMult;
  const s: TankStats = {
    ...b,
    hp: b.hp * n.hp * r,
    damage: b.damage * n.damage * r,
    pen: b.pen * n.pen * (1 + (r - 1) * 0.6),
    reload: b.reload * n.reload / (1 + (r - 1) * 0.5),
    hullArmor: scaleArmor(b.hullArmor, n.hullArmor * r),
    turretArmor: scaleArmor(b.turretArmor, n.turretArmor * r),
    ricochet: Math.min(0.9, b.ricochet * n.ricochet),
    speed: b.speed * n.mobility * (1 + (r - 1) * 0.3),
    accel: b.accel * n.mobility,
    hullTraverse: b.hullTraverse * n.mobility,
    turretTraverse: b.turretTraverse * n.mobility,
    view: b.view * n.view,
    dispersion: b.dispersion * n.accuracy,
    aimTime: b.aimTime * n.accuracy,
    gunDepression: b.gunDepression * n.gunDepression,
    shieldPower: 0,
  };
  return s;
}

// ---------------------------------------------------------------- weapons

export const WEAPONS = ['heavy', 'standard', 'rapid', 'clip'] as const;
export type WeaponId = (typeof WEAPONS)[number];

export interface WeaponInfo {
  id: WeaponId;
  name: string;
  desc: string;
}

export const WEAPON_INFO: Record<WeaponId, WeaponInfo> = {
  heavy: { id: 'heavy', name: 'Ağır Top', desc: 'Uzun dolum, çok güçlü atış.' },
  standard: { id: 'standard', name: 'Standart Top', desc: 'Orta dolum, orta hasar.' },
  rapid: { id: 'rapid', name: 'Hızlı Top', desc: 'Kısa dolum, düşük hasar.' },
  clip: { id: 'clip', name: 'Şarjörlü Top', desc: '4 mermi art arda, sonra uzun şarjör dolumu.' },
};

/** France's autoloader tradition: their clip guns cycle faster. */
export function defaultWeapon(nation: Nation): WeaponId {
  return nation === 'france' ? 'clip' : 'standard';
}

export function applyWeapon(s: TankStats, w: WeaponId, nation: Nation): TankStats {
  const o: TankStats = { ...s, hullArmor: { ...s.hullArmor }, turretArmor: { ...s.turretArmor } };
  switch (w) {
    case 'heavy':
      o.damage *= 1.55;
      o.pen *= 1.12;
      o.reload *= 1.65;
      o.aimTime *= 1.15;
      o.shellSpeed *= 0.95;
      break;
    case 'standard':
      break;
    case 'rapid':
      o.damage *= 0.55;
      o.pen *= 0.9;
      o.reload *= 0.45;
      o.dispersion *= 1.15;
      o.aimTime *= 0.85;
      break;
    case 'clip': {
      const fr = nation === 'france';
      o.damage *= 0.6;
      o.magazine = 4;
      o.clipInterval = (s.splash > 0 ? 2.2 : 0.9) * (fr ? 0.8 : 1);
      o.reload *= fr ? 2.1 : 2.6;
      break;
    }
  }
  return o;
}

// ---------------------------------------------------------------- levels

export const MAX_LEVEL = 1000;

/** Coins to go from `level` to `level + 1`. */
export function upgradeCost(level: number): number {
  return Math.round(40 * Math.pow(level, 1.3) + 60);
}

/** Each level adds a little to everything; level 1000 is about +80% core stats. */
export function applyLevel(s: TankStats, level: number): TankStats {
  const k = 1 + (Math.max(1, level) - 1) * 0.0008;
  const m = 1 + (Math.max(1, level) - 1) * 0.0002;
  return {
    ...s,
    hp: s.hp * k,
    damage: s.damage * k,
    pen: s.pen * (1 + (k - 1) * 0.6),
    reload: s.reload / (1 + (k - 1) * 0.4),
    hullArmor: { front: s.hullArmor.front * k, side: s.hullArmor.side * k, rear: s.hullArmor.rear * k },
    turretArmor: { front: s.turretArmor.front * k, side: s.turretArmor.side * k, rear: s.turretArmor.rear * k },
    speed: s.speed * m,
    view: s.view * m,
  };
}
