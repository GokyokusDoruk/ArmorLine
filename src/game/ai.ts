import * as THREE from 'three';
import { Tank, wrapAngle } from './tank';
import { ARENA_HALF, blockedAt, lineOfSight } from './world';

export interface AiWorld {
  tanks: Tank[];
  /** Is `t` currently visible to team `team`? */
  visibleTo(team: 0 | 1, t: Tank): boolean;
  /** Elevation needed for an artillery shell to land at `target`. */
  artilleryPitch(from: THREE.Vector3, target: THREE.Vector3, speed: number): number | null;
  time: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Simple role-based bot. */
export class Bot {
  target: Tank | null = null;
  goal = new THREE.Vector3();
  private think = Math.random() * 0.5;
  private stuck = 0;
  private reverse = 0;
  private avoidSign = Math.random() < 0.5 ? 1 : -1;
  private orbit = Math.random() < 0.5 ? 1 : -1;
  /** 0..1 bot skill (affects aim wobble and reaction). */
  readonly skill: number;
  private wobble = 0;
  /** Seconds since this bot's team last saw any enemy. */
  private blind = 0;
  /** Last place an enemy was seen. */
  private lastSeen: THREE.Vector3 | null = null;

  constructor(readonly tank: Tank, skill = 0.6) {
    this.skill = skill;
    this.goal.copy(tank.pos);
  }

  update(dt: number, w: AiWorld): void {
    const t = this.tank;
    if (!t.alive) {
      t.throttle = 0;
      t.steer = 0;
      t.wantFire = false;
      return;
    }
    this.blind += dt;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.4 + Math.random() * 0.3;
      this.pickTarget(w);
      this.pickGoal(w);
    }
    this.drive(dt);
    this.aimAndFire(dt, w);
  }

  private pickTarget(w: AiWorld): void {
    const t = this.tank;
    const enemyTeam = (1 - t.spec.team) as 0 | 1;
    let best: Tank | null = null;
    let bestScore = Infinity;
    for (const e of w.tanks) {
      if (!e.alive || e.spec.team !== enemyTeam) continue;
      if (!w.visibleTo(t.spec.team, e)) continue;
      const d = e.pos.distanceTo(t.pos);
      // prefer close, damaged targets
      const score = d * (0.6 + (e.hp / e.stats.hp) * 0.4);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.target = best;
    if (best) {
      this.blind = 0;
      this.lastSeen = best.pos.clone();
    }
  }

  private pickGoal(w: AiWorld): void {
    const t = this.tank;
    const dirToEnemy = t.spec.team === 0 ? 1 : -1; // team 0 spawns at -z
    const cls = t.spec.cls;
    const e = this.target;
    if (cls === 'artillery') {
      // Stay back, drift sideways a bit.
      const baseZ = -dirToEnemy * 80;
      if (Math.abs(t.pos.z - baseZ) > 12 || Math.random() < 0.05) {
        this.goal.set(THREE.MathUtils.clamp(t.pos.x + (Math.random() - 0.5) * 30, -80, 80), 0, baseZ);
      }
      return;
    }
    const prefer = cls === 'heavy' ? 26 : cls === 'mobile' ? 55 : 70;
    if (e) {
      _a.subVectors(t.pos, e.pos);
      _a.y = 0;
      const d = _a.length() || 1;
      _a.divideScalar(d);
      if (cls === 'mobile') {
        // circle at spotting distance
        const ang = Math.atan2(_a.x, _a.z) + this.orbit * 0.5;
        this.goal.set(e.pos.x + Math.sin(ang) * prefer, 0, e.pos.z + Math.cos(ang) * prefer);
      } else {
        this.goal.copy(e.pos).addScaledVector(_a, prefer);
      }
    } else if (this.lastSeen && this.blind < 12 && cls !== 'sniper') {
      // Go check where the enemy was last seen.
      this.goal.copy(this.lastSeen);
      if (t.pos.distanceTo(this.lastSeen) < 12) this.lastSeen = null;
    } else {
      // Advance toward the enemy side; the longer nothing is seen, the deeper we push.
      const push = Math.min(55, this.blind * 1.5);
      const depth = (cls === 'mobile' ? 55 : cls === 'heavy' ? 30 : -25) + push;
      const lane = ((t.id * 37) % 5) - 2;
      if (t.pos.distanceTo(this.goal) < 10 || this.goal.lengthSq() === 0 || Math.random() < 0.04) {
        this.goal.set(lane * 30 + (Math.random() - 0.5) * 20, 0, dirToEnemy * depth + (Math.random() - 0.5) * 30);
      }
    }
    const lim = ARENA_HALF - 8;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -lim, lim);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -lim, lim);
  }

  private drive(dt: number): void {
    const t = this.tank;
    _a.subVectors(this.goal, t.pos);
    _a.y = 0;
    const dist = _a.length();
    if (this.reverse > 0) {
      this.reverse -= dt;
      t.throttle = -1;
      t.steer = this.avoidSign;
      return;
    }
    const e = this.target;
    const holding =
      e && e.alive && t.spec.cls !== 'mobile' && t.pos.distanceTo(e.pos) < (t.spec.cls === 'heavy' ? 45 : 85) && t.reloadLeft < 1.5;
    if (dist < 4 || holding) {
      t.throttle = 0;
      t.steer = 0;
      this.stuck = 0;
      return;
    }
    let desired = Math.atan2(_a.x, _a.z);
    // Obstacle avoidance: probe ahead, swing around blockers.
    const r = t.dims.radius;
    for (let i = 0; i < 5; i++) {
      const probe = desired;
      const px = t.pos.x + Math.sin(probe) * (r + 6);
      const pz = t.pos.z + Math.cos(probe) * (r + 6);
      if (!blockedAt(px, pz, r * 0.8)) break;
      desired += this.avoidSign * 0.55;
    }
    const diff = wrapAngle(desired - t.yaw);
    t.steer = THREE.MathUtils.clamp(diff * 2, -1, 1);
    t.throttle = Math.abs(diff) > 1.2 ? 0.2 : Math.min(1, dist / 10);

    if (Math.abs(t.speed) < 0.4 && t.throttle > 0.3) {
      this.stuck += dt;
      if (this.stuck > 1.5) {
        this.stuck = 0;
        this.reverse = 1 + Math.random();
        this.avoidSign *= -1;
      }
    } else {
      this.stuck = Math.max(0, this.stuck - dt);
    }
  }

  private aimAndFire(dt: number, w: AiWorld): void {
    const t = this.tank;
    const e = this.target;
    t.wantFire = false;
    if (!e || !e.alive) {
      // look where we drive
      t.aimYaw = t.yaw;
      t.aimPitch = 0;
      return;
    }
    this.wobble += dt;
    const sway = (1 - this.skill) * 0.03;
    e.center(_b);
    if (t.spec.cls === 'artillery') {
      // lead the target a little
      _b.addScaledVector(e.forward, e.speed * 1.2);
      const pitch = w.artilleryPitch(t.muzzle(_a), _b, t.stats.shellSpeed);
      t.aimYaw = Math.atan2(_b.x - t.pos.x, _b.z - t.pos.z) + Math.sin(this.wobble * 1.3) * sway;
      if (pitch === null) return;
      t.artyTarget = _b.clone();
      t.aimPitch = pitch;
      const ready = Math.abs(wrapAngle(t.aimYaw - t.turretYaw)) < 0.04 && Math.abs(t.gunPitch - pitch) < 0.05;
      t.wantFire = ready && t.aim > 0.75 && t.canFire();
      return;
    }
    t.gunOrigin(_a);
    const dx = _b.x - _a.x;
    const dz = _b.z - _a.z;
    const flat = Math.hypot(dx, dz);
    t.aimYaw = Math.atan2(dx, dz) + Math.sin(this.wobble * 1.7) * sway;
    t.aimPitch = Math.atan2(_b.y - _a.y, flat) + Math.cos(this.wobble * 1.3) * sway * 0.5;
    const dist = t.pos.distanceTo(e.pos);
    const los = lineOfSight(t.muzzle(_a), _b);
    const facing = Math.abs(wrapAngle(t.aimYaw - t.turretYaw)) < 0.05;
    const mobile = t.spec.cls === 'mobile';
    const needAim = mobile ? 0.35 : dist > 50 ? 0.8 : 0.5 + (1 - this.skill) * 0.2;
    t.wantFire = los && facing && t.aim >= needAim && t.canFire();
  }
}
