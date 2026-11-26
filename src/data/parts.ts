import { RARITY_INFO, rarityIndex, type Rarity } from './rarity';
import { NATION_INFO, type Nation, type TankStats } from './tanks';

export const SLOTS = ['gun', 'turret', 'armor', 'engine', 'tracks', 'optic'] as const;
export type Slot = (typeof SLOTS)[number];

export interface SlotInfo {
  id: Slot;
  name: string;
  icon: string;
  effects: string[];
}

export const SLOT_INFO: Record<Slot, SlotInfo> = {
  gun: { id: 'gun', name: 'Main Gun', icon: '💥', effects: ['Hasar', 'Zırh delme', 'Dolum süresi'] },
  turret: { id: 'turret', name: 'Turret', icon: '🔄', effects: ['Taret dönüş hızı', 'Taret zırhı', 'Görüş', 'Sektirme'] },
  armor: { id: 'armor', name: 'Armor', icon: '🛡️', effects: ['Can', 'Gövde zırhı', 'Sektirme'] },
  engine: { id: 'engine', name: 'Engine', icon: '⚙️', effects: ['Hız', 'İvmelenme'] },
  tracks: { id: 'tracks', name: 'Palet', icon: '⛓️', effects: ['Dönüş hızı', 'Can', 'Hız'] },
  optic: { id: 'optic', name: 'Optic', icon: '🔭', effects: ['Nişan zoom', 'Zırh analizi'] },
};

export interface Part {
  id: string;
  nation: Nation;
  slot: Slot;
  rarity: Rarity;
}

export function partName(p: Part): string {
  return `${NATION_INFO[p.nation].name} ${SLOT_INFO[p.slot].name}`;
}

/** Optic analysis tier by rarity: poor/common color only, uncommon..epic + pen %, legendary+ + damage. */
export function opticTierFor(r: Rarity): number {
  const i = rarityIndex(r);
  if (i >= rarityIndex('legendary')) return 3;
  if (i >= rarityIndex('uncommon')) return 2;
  return 1;
}

/** Human-readable effect lines for a part, e.g. "+8% Hasar". */
export function partEffects(p: Part): string[] {
  const b = Math.round(RARITY_INFO[p.rarity].partBonus * 100);
  const half = Math.round(b / 2);
  switch (p.slot) {
    case 'gun':
      return [`+${b}% Hasar`, `+${b}% Zırh delme`, `-${half}% Dolum süresi`];
    case 'turret':
      return [`+${b}% Taret dönüşü`, `+${b}% Taret zırhı`, `+${half}% Görüş`, `+${half}% Sektirme`];
    case 'armor':
      return [`+${b}% Can`, `+${b}% Gövde zırhı`, `+${half}% Sektirme`];
    case 'engine':
      return [`+${b}% Hız`, `+${b * 2}% İvmelenme`];
    case 'tracks':
      return [`+${b * 2}% Dönüş hızı`, `+${half}% Can`, `+${half}% Hız`];
    case 'optic': {
      const t = opticTierFor(p.rarity);
      const lines = [`+${b * 2}% Zoom`, 'Zırh rengi (delersin/delemezsin)'];
      if (t >= 2) lines.push('Delme yüzdesi');
      if (t >= 3) lines.push('Tahmini hasar');
      return lines;
    }
  }
}

/** Applies equipped parts to a stats object (returns a new one). */
export function applyParts(stats: TankStats, parts: Part[]): TankStats {
  const s: TankStats = {
    ...stats,
    hullArmor: { ...stats.hullArmor },
    turretArmor: { ...stats.turretArmor },
  };
  for (const p of parts) {
    const b = RARITY_INFO[p.rarity].partBonus;
    const h = b / 2;
    switch (p.slot) {
      case 'gun':
        s.damage *= 1 + b;
        s.pen *= 1 + b;
        s.reload *= 1 - h;
        break;
      case 'turret':
        s.turretTraverse *= 1 + b;
        s.turretArmor.front *= 1 + b;
        s.turretArmor.side *= 1 + b;
        s.turretArmor.rear *= 1 + b;
        s.view *= 1 + h;
        s.ricochet = Math.min(0.95, s.ricochet * (1 + h));
        break;
      case 'armor':
        s.hp *= 1 + b;
        s.hullArmor.front *= 1 + b;
        s.hullArmor.side *= 1 + b;
        s.hullArmor.rear *= 1 + b;
        s.ricochet = Math.min(0.95, s.ricochet * (1 + h));
        break;
      case 'engine':
        s.speed *= 1 + b;
        s.accel *= 1 + b * 2;
        break;
      case 'tracks':
        s.hullTraverse *= 1 + b * 2;
        s.hp *= 1 + h;
        s.speed *= 1 + h;
        break;
      case 'optic':
        s.zoom *= 1 + b * 2;
        s.opticTier = opticTierFor(p.rarity);
        break;
    }
  }
  return s;
}
