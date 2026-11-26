import * as THREE from 'three';
import type { Rarity } from '../data/rarity';
import { TANK_NAMES, type ArmorSet, type Nation, type TankClass, type TankStats } from '../data/tanks';
import { DIMS, buildTankModel, setDestroyedLook, type TankDims, type TankModel } from './tankModel';
import { heightAt, rayBox, resolveCircle } from './world';

export interface TankSpec {
  name: string;
  nation: Nation;
  cls: TankClass;
  rarity: Rarity;
  stats: TankStats;
  team: 0 | 1;
  isPlayer?: boolean;
}

export interface TankHit {
  t: number;
  point: THREE.Vector3;
  /** Plate normal in world space. */
  normal: THREE.Vector3;
  part: 'hull' | 'turret';
  face: 'front' | 'side' | 'rear' | 'roof';
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

  private prevTurretYaw = 0;

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

  muzzle(out = new THREE.Vector3()): THREE.Vector3 {
    this.model.root.updateMatrixWorld(true);
    return this.model.muzzle.getWorldPosition(out);
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

  /** Current dispersion cone (radians), shrinking as aim completes. */
  currentDispersion(): number {
    return this.stats.dispersion * (1 + 4 * (1 - this.aim));
  }

  onFired(): void {
    this.ammo -= 1;
    this.aim = Math.max(0, this.aim - 0.75);
    if (this.ammo > 0) {
      this.reloadLeft = this.stats.clipInterval;
    } else {
      this.reloadLeft = this.stats.reload;
    }
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

    // Hull movement
    const targetSpeed = this.throttle * s.speed * (this.throttle < 0 ? 0.55 : 1);
    const dv = targetSpeed - this.speed;
    const acc = (Math.sign(dv) === Math.sign(this.speed) || this.speed === 0 ? s.accel : s.accel * 2.2) * dt;
    this.speed += Math.max(-acc, Math.min(acc, dv));
    const turn = this.steer * (s.hullTraverse * Math.PI / 180) * dt * (this.throttle < -0.1 ? -1 : 1);
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
    const hit = resolveCircle(this.pos, this.dims.radius * 0.85);
    if (hit) this.speed *= 0.9;

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
    const moving = Math.abs(this.speed) / s.speed;
    const penalty = moving * 0.9 + Math.min(1, turretMove * 0.6) + Math.abs(turn / Math.max(dt, 1e-4)) * 0.3;
    const rate = 1 / s.aimTime;
    this.aim += (rate - penalty * 0.9) * dt;
    this.aim = Math.max(0, Math.min(1, this.aim));
  }

  syncModel(): void {
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.set(-this.tiltPitch, this.yaw, this.tiltRoll);
    this.model.turret.rotation.y = wrapAngle(this.turretYaw - this.yaw);
    this.model.gun.rotation.x = -(this.gunPitch - this.slopeAlong(this.turretYaw));
  }

  armorFor(part: 'hull' | 'turret', face: TankHit['face']): number {
    const set: ArmorSet = part === 'hull' ? this.stats.hullArmor : this.stats.turretArmor;
    if (face === 'roof') return set.rear * 0.5;
    return set[face];
  }

  /** Ray test against hull and turret boxes (yaw-aligned). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): TankHit | null {
    const d = this.dims;
    let best: TankHit | null = null;
    const boxes: { part: 'hull' | 'turret'; yaw: number; cz: number; y0: number; y1: number; hw: number; hl: number }[] = [
      { part: 'hull', yaw: this.yaw, cz: 0, y0: 0, y1: d.H, hw: d.W / 2, hl: d.L / 2 },
      { part: 'turret', yaw: this.turretYaw, cz: d.tZ, y0: d.H * 0.95, y1: d.H * 0.95 + d.tH, hw: d.tW / 2, hl: d.tL / 2 },
    ];
    for (const b of boxes) {
      // Turret center sits on the hull at offset tZ along the hull's forward axis.
      const cx = this.pos.x + Math.sin(this.yaw) * b.cz;
      const cz = this.pos.z + Math.cos(this.yaw) * b.cz;
      const c = Math.cos(-b.yaw);
      const s = Math.sin(-b.yaw);
      const ox = origin.x - cx;
      const oz = origin.z - cz;
      // rotate into local frame (local +z = forward)
      const lox = ox * c + oz * s;
      const loz = -ox * s + oz * c;
      const ldx = dir.x * c + dir.z * s;
      const ldz = -dir.x * s + dir.z * c;
      const n = new THREE.Vector3();
      const t = rayBox(
        lox, origin.y - this.pos.y, loz, ldx, dir.y, ldz,
        -b.hw, b.y0, -b.hl, b.hw, b.y1, b.hl, maxT, n,
      );
      if (t >= 0 && (!best || t < best.t)) {
        let face: TankHit['face'];
        if (n.y > 0.5) face = 'roof';
        else if (n.z > 0.5) face = 'front';
        else if (n.z < -0.5) face = 'rear';
        else face = 'side';
        // Real tanks slope their front plates: add a built-in angle on the front face.
        const worldN = new THREE.Vector3(n.x * Math.cos(b.yaw) + n.z * Math.sin(b.yaw), n.y, -n.x * Math.sin(b.yaw) + n.z * Math.cos(b.yaw));
        if (face === 'front') worldN.y += 0.45;
        worldN.normalize();
        best = {
          t,
          point: origin.clone().addScaledVector(dir, t),
          normal: worldN,
          part: b.part,
          face,
          thickness: this.armorFor(b.part, face),
        };
      }
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
    if (from && from.spec.team !== this.spec.team) from.damageDealt += Math.min(amount, amount + this.hp);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.speed = 0;
      setDestroyedLook(this.model);
      if (from && from !== this) from.kills += 1;
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
