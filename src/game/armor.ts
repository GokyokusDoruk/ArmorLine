/** Pure penetration / ricochet math, shared by shells and the optic analysis. */

export type HitResult = 'pen' | 'ricochet' | 'blocked';

/** Pen and damage both roll uniformly within ±25%. */
export const ROLL = 0.25;
/** Beyond this impact angle (from the plate normal) shells almost always bounce. */
export const AUTO_RICOCHET_DEG = 70;

/** Armor a shell must go through at this impact angle (degrees from normal). */
export function effectiveArmor(thickness: number, angleDeg: number): number {
  const a = Math.min(85, Math.max(0, angleDeg));
  return thickness / Math.cos((a * Math.PI) / 180);
}

/** Chance (0..1) to bounce. `ricochetStat` is the target's sektirme stat (0..1). */
export function ricochetChance(pen: number, thickness: number, angleDeg: number, ricochetStat: number): number {
  if (pen > thickness * 3) return 0; // overmatch: big guns never bounce off thin plates
  if (angleDeg >= AUTO_RICOCHET_DEG) return Math.min(1, 0.85 + ricochetStat * 0.15);
  if (angleDeg <= 30) return 0;
  const t = (angleDeg - 30) / (AUTO_RICOCHET_DEG - 30);
  return Math.min(1, ricochetStat * t * t * 1.4);
}

/** Chance (0..1) that a pen roll beats the effective armor. */
export function penChance(pen: number, effArmor: number): number {
  if (pen <= 0) return 0;
  const lo = 1 - ROLL;
  const hi = 1 + ROLL;
  const need = effArmor / pen;
  return Math.min(1, Math.max(0, (hi - need) / (hi - lo)));
}

export interface ShotAnalysis {
  effArmor: number;
  /** Final chance to deal full damage. */
  chance: number;
  expectedDamage: number;
}

export function analyzeShot(
  pen: number,
  damage: number,
  thickness: number,
  angleDeg: number,
  ricochetStat: number,
): ShotAnalysis {
  const eff = effectiveArmor(thickness, angleDeg);
  const chance = penChance(pen, eff) * (1 - ricochetChance(pen, thickness, angleDeg, ricochetStat));
  return { effArmor: eff, chance, expectedDamage: Math.round(damage * chance) };
}

export interface ResolvedHit {
  result: HitResult;
  damage: number;
}

export function resolveHit(
  pen: number,
  damage: number,
  thickness: number,
  angleDeg: number,
  ricochetStat: number,
  rand: () => number = Math.random,
): ResolvedHit {
  if (rand() < ricochetChance(pen, thickness, angleDeg, ricochetStat)) return { result: 'ricochet', damage: 0 };
  const roll = (x: number) => x * (1 - ROLL + rand() * ROLL * 2);
  if (roll(pen) < effectiveArmor(thickness, angleDeg)) return { result: 'blocked', damage: 0 };
  return { result: 'pen', damage: Math.round(roll(damage)) };
}

/** Red (can't pen) → yellow → green (sure pen). */
export function chanceColor(chance: number): string {
  const c = Math.max(0, Math.min(1, chance));
  const r = c < 0.5 ? 255 : Math.round(255 * (1 - c) * 2);
  const g = c < 0.5 ? Math.round(255 * c * 2) : 220;
  return `rgb(${r},${g},60)`;
}
