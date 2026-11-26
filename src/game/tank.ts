import * as THREE from 'three';
import type { Rarity } from '../data/rarity';
import { TANK_NAMES, type Nation, type TankClass, type TankStats } from '../data/tanks';
import { DIMS, buildTankModel, setDestroyedLook, type TankDims, type TankModel } from './tankModel';
import { heightAt, rayBox, resolveRect, type Rect } from './world';
import { SHIELD_RECHARGE } from '../data/parts';

/** Hitting a wall slower than this does no damage (units/s). */
export const WALL_SAFE_SPEED = 5;
const _tmp = new THREE.Vector3();

export interface TankSpec {
  name: string;
  nation: Nation;
  cls: TankClass;
  rarity: Rarity;
  stats: TankStats;
  team: 0 | 1;
  isPlayer?: boolean;
}

export type ArmorZone =
  | 'upperFront' | 'lowerFront' | 'side' | 'track' | 'rear' | 'roof'
  | 'turretFront' | 'turretSide' | 'turretRear' | 'cupola' | 'fuel';

export interface ZoneInfo {
  name: string;
  /** Damage multiplier after a penetration: front takes less, rear takes more. */
  dmgMult: number;
  /** Extra ricochet chance (upper plates are steeply sloped). */
  ricochetBonus: number;
  /** Built-in plate slope added to the face normal (bigger = more angled). */
  slope: number;
  /** Shown as a weak spot when zoomed in. */
  weak: boolean;
}

export const ZONES: Record<ArmorZone, ZoneInfo> = {
  upperFront: { name: 'Üst ön plaka', dmgMult: 0.85, ricochetBonus: 0.15, slope: 0.75, weak: false },
  lowerFront: { name: 'Alt ön plaka', dmgMult: 1, ricochetBonus: 0, slope: 0.1, weak: true },
  side: { name: 'Yan', dmgMult: 1, ricochetBonus: 0, slope: 0, weak: false },
  track: { name: 'Palet', dmgMult: 0.8, ricochetBonus: 0, slope: 0, weak: false },
  rear: { name: 'Arka (motor)', dmgMult: 1.25, ricochetBonus: 0, slope: 0, weak: true },
  roof: { name: 'Tavan', dmgMult: 1.1, ricochetBonus: 0, slope: 0, weak: false },
  turretFront: { name: 'Taret önü', dmgMult: 0.85, ricochetBonus: 0.05, slope: 0.45, weak: false },
  turretSide: { name: 'Taret yanı', dmgMult: 1, ricochetBonus: 0, slope: 0, weak: false },
  turretRear: { name: 'Dolum bölmesi', dmgMult: 1.25, ricochetBonus: 0, slope: 0, weak: true },
  cupola: { name: 'Kupola', dmgMult: 1.1, ricochetBonus: 0, slope: 0, weak: true },
  fuel: { name: 'Yakıt deposu', dmgMult: 1.1, ricochetBonus: 0, slope: 0, weak: true },
};

/** Weak-spot overlay keys and the armor zone each one shows. */
export const WEAK_KEYS = { lowerFront: 'lowerFront', rear: 'rear', cupola: 'cupola', loader: 'turretRear', fuelL: 'fuel', fuelR: 'fuel' } as const;
export type WeakKey = keyof typeof WEAK_KEYS;

/** A burning tank loses this share of its max HP per second. */
export const FIRE_DPS = 0.025;
export const FIRE_SECONDS = 5;
/** A penetrating hit on the loader (turret rear) doubles reload time for the rest of the match. */
export const LOADER_RELOAD_MULT = 2;
/** Assists count damage dealt within this many seconds before the kill. */
export const ASSIST_WINDOW = 20;

/** Chance that a penetrating rear hit damages the engine. */
export const ENGINE_DAMAGE_CHANCE = 0.35;
/** Seconds a tank can't drive after a track hit. */
export const TRACK_STUN = 2;

export interface TankHit {
  t: number;
  point: THREE.Vector3;
  /** Plate normal in world space (including the plate's built-in slope). */
  normal: THREE.Vector3;
  part: 'hull' | 'turret';
  zone: ArmorZone;
  thickness: number;
}

let nextId = 1;

export class Tank {
  readonly id = nextId++;
  readonly spec: TankSpec;
  readonly stats: TankStats;
  readonly dims: TankDims;
  readonly model: TankModel;
  readonly modelName: string;

  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  turretYaw = 0;
  gunPitch = 0;
  /** Hull pitch/roll from terrain. */
  tiltPitch = 0;
  tiltRoll = 0;

  hp: number;
  alive = true;
  /** Shots left in the magazine and reload timer. */
  ammo: number;
  reloadLeft = 0;
  /** 0..1 aim progress. */
  aim = 0;
  /** Seconds this tank stays visible to the enemy team after being seen. */
  spottedTimer = 0;
  spotted = false;
  damageDealt = 0;
  kills = 0;
  lastHitBy: Tank | null = null;

  // control inputs (set by player input or AI)
  throttle = 0;
  steer = 0;
  aimYaw = 0;
  aimPitch = 0;
  wantFire = false;
  /** Where an artillery tank wants its shell to land. */
  artyTarget: THREE.Vector3 | null = null;

  /** Seconds left with broken tracks (can't drive or turn the hull). */
  trackedTimer = 0;
  /** Engine damaged: top speed halved for the rest of the match. */
  engineDamaged = false;
  /** Loader hit: reload doubled for the rest of the match. */
  loaderDamaged = false;
  /** Seconds left burning, who set the fire, and damage waiting to be applied. */
  burnTimer = 0;
  burnSource: Tank | null = null;
  burnPending = 0;
  /** 0..1 electric shield charge (only if stats.shieldPower > 0). */
  shieldCharge = 1;
  /** 0..1 shield flash after absorbing a hit (visual). */
  shieldFlash = 0;
  /** Which track is broken (visual), if any. */
  brokenTrack: 'left' | 'right' | null = null;
  assists = 0;
  /** Enemy tanks that damaged us and when (for assists). */
  readonly damageLog = new Map<Tank, number>();
  /** Visual shake of the hull: amplitude along local x/z and time since it started. */
  private rock = { x: 0, z: 0, t: 99 };
  private recoil = 0;
  time = 0;

  private prevTurretYaw = 0;
  private impactCooldown = 0;
  /** Damage from hitting a wall this frame (read and cleared by the battle). */
  wallImpact = 0;

  constructor(spec: TankSpec) {
    this.spec = spec;
    this.stats = spec.stats;
    this.dims = DIMS[spec.cls];
    this.model = buildTankModel(spec.nation, spec.cls, spec.rarity);
    this.model.root.rotation.order = 'YXZ';
    this.hp = spec.stats.hp;
    this.ammo = spec.stats.magazine;
    this.modelName = TANK_NAMES[spec.nation][spec.cls];
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** World-space center used for aiming and spotting. */
  center(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.dims.H * 0.75, this.pos.z);
  }

  eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.dims.H + this.dims.tH + 0.4, this.pos.z);
  }

  /** Gun trunnion (the point the barrel pivots around), in world space. */
  gunOrigin(out = new THREE.Vector3()): THREE.Vector3 {
    this.model.root.updateMatrixWorld(true);
    return this.model.gun.getWorldPosition(out);
  }

  /** Muzzle position on the exact line the shell travels along. */
  muzzle(out = new THREE.Vector3()): THREE.Vector3 {
    this.gunOrigin(out);
    return out.addScaledVector(this.gunDir(_tmp), this.dims.barrel + 0.3);
  }

  /** Footprint used for collisions (hull plus a little track overhang). */
  rect(): Rect {
    return { cx: this.pos.x, cz: this.pos.z, hx: this.dims.W / 2, hz: this.dims.L / 2, yaw: this.yaw };
  }

  gunDir(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.gunPitch);
    return out.set(Math.sin(this.turretYaw) * cp, Math.sin(this.gunPitch), Math.cos(this.turretYaw) * cp);
  }

  /** Hull slope (radians, nose-up positive) along a world yaw. */
  slopeAlong(yaw: number): number {
    const fwdPitch = this.tiltPitch;
    const sideRoll = this.tiltRoll;
    const rel = yaw - this.yaw;
    return fwdPitch * Math.cos(rel) + sideRoll * Math.sin(rel);
  }

  canFire(): boolean {
    return this.alive && this.reloadLeft <= 0 && this.ammo > 0;
  }

  /**
   * Current dispersion cone (radians). It shrinks while you hold still and is zero at full aim,
   * so a fully aimed shot lands exactly on the marker. Artillery keeps a small spread.
   */
  currentDispersion(): number {
    const k = Math.pow(1 - this.aim, 1.5) * 6;
    return this.stats.dispersion * (this.stats.splash > 0 ? 0.35 + k : k);
  }

  onFired(): void {
    this.ammo -= 1;
    this.aim = Math.max(0, this.aim - 0.75);
    const mult = this.loaderDamaged ? LOADER_RELOAD_MULT : 1;
    if (this.ammo > 0) {
      this.reloadLeft = this.stats.clipInterval * mult;
    } else {
      this.reloadLeft = this.stats.reload * mult;
    }
    // Recoil: barrel kicks back, hull rocks opposite to the gun.
    this.recoil = 1;
    const rel = this.turretYaw - this.yaw;
    const k = 0.5 + Math.min(1, this.stats.damage / 500) * 0.6;
    this.shakeHull(-Math.sin(rel) * k, -Math.cos(rel) * k);
  }

  /** Rock the hull along a local direction (x = right side, z = front). */
  shakeHull(x: number, z: number): void {
    this.rock = { x, z, t: 0 };
  }

  /** Electric shield: a full shield stops shieldPower of the damage, then needs SHIELD_RECHARGE s to refill. */
  absorb(dmg: number): number {
    const p = this.stats.shieldPower;
    if (p <= 0 || dmg <= 0) return dmg;
    const stopped = dmg * p * this.shieldCharge;
    this.shieldFlash = Math.max(this.shieldFlash, 0.3 + this.shieldCharge * 0.7);
    this.shieldCharge = 0;
    return Math.round(dmg - stopped);
  }

  update(dt: number): void {
    if (!this.alive) return;
    const s = this.stats;

    // Reload
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        if (this.ammo <= 0) this.ammo = s.magazine;
      }
    }

    this.time += dt;
    if (this.stats.shieldPower > 0) this.shieldCharge = Math.min(1, this.shieldCharge + dt / SHIELD_RECHARGE);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 1.8);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.rock.t += dt;
    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this.burnPending += this.stats.hp * FIRE_DPS * dt;
    }

    // Hull movement. Broken tracks: no drive or turning, the tank brakes to a stop.
    const tracked = this.trackedTimer > 0;
    if (tracked) this.trackedTimer -= dt;
    const topSpeed = s.speed * (this.engineDamaged ? 0.5 : 1);
    const throttle = tracked ? 0 : this.throttle;
    const steer = tracked ? 0 : this.steer;
    const targetSpeed = throttle * topSpeed * (throttle < 0 ? 0.55 : 1);
    const dv = targetSpeed - this.speed;
    const braking = tracked ? 1.2 : Math.sign(dv) === Math.sign(this.speed) || this.speed === 0 ? 1 : 2.2;
    const acc = s.accel * braking * (this.engineDamaged ? 0.6 : 1) * dt;
    this.speed += Math.max(-acc, Math.min(acc, dv));
    const turn = steer * (s.hullTraverse * Math.PI / 180) * dt * (throttle < -0.1 ? -1 : 1);
    this.yaw += turn;
    // Turret keeps its world direction while the hull turns, then traverses toward aim.
    const maxT = (s.turretTraverse * Math.PI / 180) * dt;
    let d = wrapAngle(this.aimYaw - this.turretYaw);
    this.turretYaw = wrapAngle(this.turretYaw + Math.max(-maxT, Math.min(maxT, d)));

    // Gun pitch with depression / elevation limits relative to the hull slope.
    const slope = this.slopeAlong(this.turretYaw);
    const minP = slope - (s.gunDepression * Math.PI) / 180;
    const maxP = slope + (s.gunElevation * Math.PI) / 180;
    const pRate = 0.9 * dt;
    const tp = Math.max(minP, Math.min(maxP, this.aimPitch));
    this.gunPitch += Math.max(-pRate, Math.min(pRate, tp - this.gunPitch));

    const f = this.forward;
    this.pos.addScaledVector(f, this.speed * dt);
    const r = this.rect();
    const push = resolveRect(r, this.pos.y);
    if (push) {
      this.pos.x = r.cx;
      this.pos.z = r.cz;
      const len = Math.hypot(push.x, push.z);
      // Speed into the wall = velocity component against the push direction.
      const into = -(f.x * this.speed * push.x + f.z * this.speed * push.z) / len;
      if (into > WALL_SAFE_SPEED && this.impactCooldown <= 0) {
        this.wallImpact = Math.round(Math.pow(into - WALL_SAFE_SPEED, 1.5) * 9 * s.mass);
        this.impactCooldown = 0.6;
        this.speed *= 0.25;
      } else {
        this.speed *= 0.9;
      }
    }
    this.impactCooldown -= dt;

    this.pos.y = heightAt(this.pos.x, this.pos.z);
    // Tilt from terrain samples
    const L = this.dims.L * 0.45;
    const W = this.dims.W * 0.45;
    const hf = heightAt(this.pos.x + f.x * L, this.pos.z + f.z * L);
    const hb = heightAt(this.pos.x - f.x * L, this.pos.z - f.z * L);
    const hr = heightAt(this.pos.x + f.z * W, this.pos.z - f.x * W);
    const hl = heightAt(this.pos.x - f.z * W, this.pos.z + f.x * W);
    this.tiltPitch = Math.atan2(hf - hb, 2 * L);
    this.tiltRoll = Math.atan2(hr - hl, 2 * W);
    this.pos.y = (hf + hb + hr + hl) / 4;

    // Aim bloom: moving and turning slow the aim.
    const turretMove = Math.abs(wrapAngle(this.turretYaw - this.prevTurretYaw)) / Math.max(dt, 1e-4);
    this.prevTurretYaw = this.turretYaw;
    const moving = Math.min(1, Math.abs(this.speed) / s.speed);
    const turning = Math.abs(turn / Math.max(dt, 1e-4));
    const penalty = moving * 2 + Math.min(1.5, turretMove * 1.2) + turning * 0.8;
    const rate = 1 / s.aimTime;
    this.aim += (rate - penalty * 0.8) * dt;
    // Moving caps how well you can aim; only standing still reaches a perfect shot.
    const cap = 1 - Math.min(0.85, moving * 0.85 + turning * 0.4 + Math.min(0.5, turretMove * 0.5));
    this.aim = Math.max(0, Math.min(cap, this.aim));
  }

  syncModel(): void {
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.set(-this.tiltPitch, this.yaw, this.tiltRoll);
    this.model.turret.rotation.y = wrapAngle(this.turretYaw - this.yaw);
    this.model.gun.rotation.x = -(this.gunPitch - this.slopeAlong(this.turretYaw));
    // Damped wobble after firing, hits and collisions.
    const w = Math.exp(-this.rock.t * 5) * Math.cos(this.rock.t * 17);
    this.model.body.rotation.x = this.rock.z * 0.09 * w;
    this.model.body.rotation.z = -this.rock.x * 0.09 * w;
    if (this.model.recoil) this.model.recoil.position.z = -this.recoil * this.recoil * this.dims.barrel * 0.12;
    const sh = this.model.shield;
    if (sh) {
      const on = this.alive && this.stats.shieldPower > 0;
      const idle = this.shieldCharge >= 1 ? 0.05 + 0.03 * Math.sin(this.time * 3) : 0;
      const o = on ? Math.max(idle, this.shieldFlash * 0.75) : 0;
      sh.visible = o > 0.005;
      (sh.material as THREE.MeshBasicMaterial).opacity = o;
      sh.scale.setScalar(1 + this.shieldFlash * 0.06);
      sh.rotation.y = this.time * 0.6;
    }
  }

  /** A point inside the collision box that lies behind the given weak-spot plate. */
  weakSpotPoint(key: WeakKey | ArmorZone): THREE.Vector3 {
    const d = this.dims;
    const f = this.forward;
    // local +x in world space (forward = (sin, cos) -> +x = (cos, -sin))
    const right = new THREE.Vector3(f.z, 0, -f.x);
    const p = this.pos.clone();
    switch (key) {
      case 'lowerFront':
        return p.addScaledVector(f, d.L / 2 - 0.2).setY(this.pos.y + d.H * 0.2);
      case 'rear':
        return p.addScaledVector(f, -(d.L / 2 - 0.2)).setY(this.pos.y + d.H * 0.35);
      case 'fuelL':
      case 'fuel':
        return p.addScaledVector(f, -d.L * 0.38).addScaledVector(right, -(d.W / 2 - 0.2)).setY(this.pos.y + d.H * 0.72);
      case 'fuelR':
        return p.addScaledVector(f, -d.L * 0.38).addScaledVector(right, d.W / 2 - 0.2).setY(this.pos.y + d.H * 0.72);
      case 'loader':
      case 'turretRear': {
        const tf = new THREE.Vector3(Math.sin(this.turretYaw), 0, Math.cos(this.turretYaw));
        return p.addScaledVector(f, d.tZ).addScaledVector(tf, -(d.tL / 2 - 0.15)).setY(this.pos.y + d.H * 0.95 + d.tH * 0.45);
      }
      default:
        // cupola: top of the turret
        return p.addScaledVector(f, d.tZ).setY(this.pos.y + d.H * 0.95 + d.tH * 0.85);
    }
  }

  /** Plate thickness of a zone. Lower front and cupola are thin weak spots. */
  armorFor(zone: ArmorZone): number {
    const h = this.stats.hullArmor;
    const t = this.stats.turretArmor;
    switch (zone) {
      case 'upperFront': return h.front;
      case 'lowerFront': return h.front * 0.6;
      case 'side': return h.side;
      case 'track': return h.side * 0.8;
      case 'rear': return h.rear;
      case 'roof': return h.rear * 0.5;
      case 'turretFront': return t.front;
      case 'turretSide': return t.side;
      case 'turretRear': return t.rear;
      case 'cupola': return t.side * 0.5;
      case 'fuel': return h.rear * 0.9;
    }
  }

  /** Ray test against hull and turret boxes (yaw-aligned), resolving the armor zone hit. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): TankHit | null {
    const d = this.dims;
    let best: TankHit | null = null;
    const boxes: { part: 'hull' | 'turret'; yaw: number; cz: number; y0: number; y1: number; hw: number; hl: number }[] = [
      { part: 'hull', yaw: this.yaw, cz: 0, y0: 0, y1: d.H, hw: d.W / 2, hl: d.L / 2 },
      { part: 'turret', yaw: this.turretYaw, cz: d.tZ, y0: d.H * 0.95, y1: d.H * 0.95 + d.tH, hw: d.tW / 2, hl: d.tL / 2 },
    ];
    for (const b of boxes) {
      const cx = this.pos.x + Math.sin(this.yaw) * b.cz;
      const cz = this.pos.z + Math.cos(this.yaw) * b.cz;
      const c = Math.cos(-b.yaw);
      const sn = Math.sin(-b.yaw);
      const ox = origin.x - cx;
      const oz = origin.z - cz;
      const lox = ox * c + oz * sn;
      const loz = -ox * sn + oz * c;
      const ldx = dir.x * c + dir.z * sn;
      const ldz = -dir.x * sn + dir.z * c;
      const n = new THREE.Vector3();
      const t = rayBox(lox, origin.y - this.pos.y, loz, ldx, dir.y, ldz, -b.hw, b.y0, -b.hl, b.hw, b.y1, b.hl, maxT, n);
      if (t < 0 || (best && t >= best.t)) continue;
      const localY = origin.y - this.pos.y + dir.y * t;
      const localZ = loz + ldz * t;
      let zone: ArmorZone;
      if (b.part === 'hull') {
        if (n.y > 0.5) zone = 'roof';
        else if (n.z > 0.5) zone = localY < d.H * 0.4 ? 'lowerFront' : 'upperFront';
        else if (n.z < -0.5) zone = localY > d.H * 0.55 ? 'fuel' : 'rear';
        else if (localY < d.H * 0.45) zone = 'track';
        else zone = localZ < -b.hl * 0.5 ? 'fuel' : 'side';
      } else {
        const top = localY > b.y1 - d.tH * 0.3;
        if (n.y > 0.5 || (top && n.z > -0.5)) zone = 'cupola';
        else if (n.z > 0.5) zone = 'turretFront';
        else if (n.z < -0.5) zone = 'turretRear';
        else zone = 'turretSide';
      }
      const worldN = new THREE.Vector3(n.x * Math.cos(b.yaw) + n.z * Math.sin(b.yaw), n.y, -n.x * Math.sin(b.yaw) + n.z * Math.cos(b.yaw));
      worldN.y += ZONES[zone].slope;
      worldN.normalize();
      best = { t, point: origin.clone().addScaledVector(dir, t), normal: worldN, part: b.part, zone, thickness: this.armorFor(zone) };
    }
    return best;
  }

  /** Impact angle (degrees from plate normal) for a shell travelling along `dir`. */
  static impactAngle(dir: THREE.Vector3, normal: THREE.Vector3): number {
    const c = Math.max(-1, Math.min(1, -dir.dot(normal)));
    return (Math.acos(c) * 180) / Math.PI;
  }

  damage(amount: number, from: Tank | null): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.lastHitBy = from;
    const enemy = !!from && from.spec.team !== this.spec.team;
    if (from && enemy) {
      from.damageDealt += Math.min(amount, amount + this.hp);
      this.damageLog.set(from, this.time);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.speed = 0;
      this.burnTimer = 0;
      setDestroyedLook(this.model);
      // Kill goes to the enemy that dealt the final damage (or the last one who hit us, e.g. after a wall crash);
      // anyone else who hurt us recently gets an assist.
      const killer = enemy ? from : [...this.damageLog.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (killer) killer.kills += 1;
      for (const [t, when] of this.damageLog) {
        if (t !== killer && this.time - when <= ASSIST_WINDOW) t.assists += 1;
      }
      return true;
    }
    return false;
  }
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
