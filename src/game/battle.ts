import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RARITIES, rarityIndex, type Rarity } from '../data/rarity';
import { NATIONS, baseTankStats, type TankClass } from '../data/tanks';
import { Bot, type AiWorld } from './ai';
import { analyzeShot, chanceColor, resolveHit } from './armor';
import { OPTIC_ERROR } from '../data/parts';
import { sfx } from './audio';
import { Fx } from './fx';
import { Hud } from './hud';
import { Input } from './input';
import { ENGINE_DAMAGE_CHANCE, TRACK_STUN, Tank, ZONES, wrapAngle, type ArmorZone, type TankHit, type TankSpec } from './tank';
import { updateDivineTrim, updateTrackAnim } from './tankModel';
import { buildWorld, heightAt, lineOfSight, raycastStatic, rectOverlap } from './world';

export const MATCH_SECONDS = 300;
const GRAVITY_ARTY = 30;
/** Closing speed (units/s) needed before a collision counts as a ram. */
const RAM_MIN_SPEED = 4;
/** How long a target spotted by a Mobil tank stays visible to its team. */
const SPOTTER_SECONDS = 10;
const ARTY_PITCH = (50 * Math.PI) / 180;

/** Muzzle speed needed to land at `target` when fired at `pitch`; null if impossible. */
function artillerySpeed(from: THREE.Vector3, target: THREE.Vector3, pitch: number): number | null {
  const x = Math.hypot(target.x - from.x, target.z - from.z);
  const y = target.y - from.y;
  const c = Math.cos(pitch);
  const den = 2 * c * c * (x * Math.tan(pitch) - y);
  if (x < 2 || den <= 0) return null;
  return Math.sqrt((GRAVITY_ARTY * x * x) / den);
}
const TEAM_SIZE = 5;
const LINEUP: TankClass[] = ['heavy', 'heavy', 'mobile', 'sniper', 'artillery'];

const BOT_NAMES = [
  'Kurt', 'Demir', 'Atlas', 'Kartal', 'Yıldırım', 'Poyraz', 'Bora', 'Toros', 'Kaya', 'Tufan',
  'Nova', 'Viper', 'Rogue', 'Hawk', 'Titan', 'Ghost', 'Raven', 'Blaze', 'Onyx', 'Jet',
  'Zeus', 'Kobra', 'Panter', 'Reis', 'Kaplan', 'Şimşek', 'Fırtına', 'Duman', 'Ateş', 'Pars',
];

export interface BattleResult {
  win: boolean;
  draw: boolean;
  damage: number;
  kills: number;
  survived: boolean;
}

export interface PlayerLoadout {
  spec: Omit<TankSpec, 'team' | 'name' | 'isPlayer'>;
  name: string;
}

interface Shell {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Tank;
  gravity: number;
  life: number;
  mesh: THREE.Mesh;
  pen: number;
  dmg: number;
  splash: number;
}

export interface BattleOptions {
  quality: 'high' | 'low';
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class Battle implements AiWorld {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  tanks: Tank[] = [];
  player: Tank;
  time = 0;
  timeLeft = MATCH_SECONDS;
  private bots: Bot[] = [];
  private shells: Shell[] = [];
  private fx: Fx;
  private hud: Hud;
  private input: Input;
  private composer: EffectComposer | null = null;
  private visibleUntil: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  private spotTimer = 0;
  private camYaw = 0;
  private camPitch = 0.05;
  private zoomed = false;
  private arty = false;
  private artyTarget = new THREE.Vector3();
  private artyRing: THREE.Mesh;
  private lock: Tank | null = null;
  private aimPoint = new THREE.Vector3();
  private shake = 0;
  private ended = false;
  private endTimer = 0;
  private result: BattleResult | null = null;
  private timeScale = 1;
  private spectate: Tank | null = null;
  private shellGeo = new THREE.CapsuleGeometry(0.12, 1.4, 2, 6);
  private shellMat = [
    new THREE.MeshBasicMaterial({ color: 0x9dffb0 }),
    new THREE.MeshBasicMaterial({ color: 0xffb070 }),
  ];
  private lastFireSound = 0;
  private dustTimer = 0;
  private paused = false;
  private ramCooldown = new Map<number, number>();

  constructor(
    private renderer: THREE.WebGLRenderer,
    uiRoot: HTMLElement,
    loadout: PlayerLoadout,
    opts: BattleOptions,
    private onEnd: (r: BattleResult) => void,
    private onQuit: () => void,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 700);
    buildWorld(this.scene);
    this.fx = new Fx(this.scene);
    this.hud = new Hud(uiRoot);
    const controls = document.createElement('div');
    controls.className = 'controls';
    uiRoot.appendChild(controls);
    this.input = new Input(controls, renderer.domElement);

    // Teams
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const pr = loadout.spec.rarity;
    let ni = 0;
    for (const team of [0, 1] as const) {
      const lineup = [...LINEUP];
      if (team === 0) lineup.splice(lineup.indexOf(loadout.spec.cls), 1);
      for (let i = 0; i < TEAM_SIZE; i++) {
        let spec: TankSpec;
        if (team === 0 && i === 0) {
          spec = { ...loadout.spec, team, name: loadout.name, isPlayer: true };
        } else {
          const cls = team === 0 ? lineup[i - 1] : lineup[i];
          const nation = NATIONS[Math.floor(Math.random() * NATIONS.length)];
          const rarity = botRarity(pr);
          spec = { name: names[ni++ % names.length], nation, cls, rarity, stats: baseTankStats(nation, cls, rarity), team };
        }
        const t = new Tank(spec);
        this.tanks.push(t);
        this.scene.add(t.model.root);
      }
    }
    this.player = this.tanks[0];
    this.placeTeams();
    for (const t of this.tanks) {
      if (t !== this.player) this.bots.push(new Bot(t, 0.45 + Math.random() * 0.35));
    }
    this.camYaw = this.player.yaw;

    // Artillery ground ring
    this.artyRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    );
    this.artyRing.rotation.x = -Math.PI / 2;
    this.artyRing.renderOrder = 10;
    this.artyRing.visible = false;
    this.scene.add(this.artyRing);
    this.artyTarget.set(0, 0, 0);

    this.hud.setupTeams(this.tanks, this.player);
    this.input.bindButton(this.hud.fireBtn, () => (this.input.firing = true), () => (this.input.firing = false));
    this.input.bindButton(this.hud.zoomBtn, () => (this.input.zoomPressed = true));
    this.input.bindButton(this.hud.artyBtn, () => (this.input.artyPressed = true));
    this.input.bindButton(this.hud.menuBtn, () => this.togglePause());

    if (opts.quality === 'high') {
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82));
      this.composer.addPass(new OutputPass());
    }
    this.resize();
    this.spotting();
  }

  private placeTeams(): void {
    for (const team of [0, 1] as const) {
      const members = this.tanks.filter((t) => t.spec.team === team);
      const s = team === 0 ? -1 : 1;
      members.forEach((t, i) => {
        const x = [-34, -17, 0, 17, 34][i] * s;
        const z = (t.spec.cls === 'artillery' ? 92 : t.spec.cls === 'sniper' ? 88 : 82) * s;
        t.pos.set(x, heightAt(x, z), z);
        t.yaw = team === 0 ? 0 : Math.PI;
        t.turretYaw = t.yaw;
        t.aimYaw = t.yaw;
        t.update(0.0001);
        t.syncModel();
      });
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // Keep a fixed horizontal FOV so portrait phones still see enough.
    const hFov = 78;
    let vFov = (2 * Math.atan(Math.tan((hFov * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    vFov = Math.min(95, Math.max(50, vFov));

    this.camera.fov = this.zoomed ? vFov / this.player.stats.zoom : vFov;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.fx.setScale(h, this.camera.fov);
  }


  visibleTo(team: 0 | 1, t: Tank): boolean {
    if (t.spec.team === team) return true;
    if (!t.alive) return true;
    return (this.visibleUntil[team].get(t.id) ?? -1) > this.time;
  }

  /** Artillery fires at a fixed elevation; returns it if the target is within range. */
  artilleryPitch(from: THREE.Vector3, target: THREE.Vector3, vMax: number): number | null {
    const v = artillerySpeed(from, target, ARTY_PITCH);
    return v !== null && v <= vMax ? ARTY_PITCH : null;
  }

  private spotting(): void {
    for (const team of [0, 1] as const) {
      const eyes = this.tanks.filter((t) => t.alive && t.spec.team === team);
      for (const e of this.tanks) {
        if (e.spec.team === team || !e.alive) continue;
        e.center(_v2);
        for (const a of eyes) {
          const d = a.pos.distanceTo(e.pos);
          if (d > a.stats.view) continue;
          if (d < 14 || lineOfSight(a.eye(_v1), _v2)) {
            // Spotters (Mobil) keep what they see lit up for the whole team for 10 s.
            const until = this.time + (a.spec.cls === 'mobile' ? SPOTTER_SECONDS : 2.5);
            if (until > (this.visibleUntil[team].get(e.id) ?? 0)) this.visibleUntil[team].set(e.id, until);
            if (a.spec.cls === 'mobile') break;
          }
        }
      }
    }
  }

  private togglePause(): void {
    this.paused = !this.paused;
    const panel = this.hud.deadPanel;
    if (this.paused) {
      panel.classList.remove('hidden');
      panel.innerHTML = `<h2>Duraklatıldı</h2>
        <button class="ui-btn primary" data-a="resume">Devam et</button>
        <button class="ui-btn danger" data-a="quit">Savaştan çık (yenilgi)</button>
        <a class="ui-btn" href="https://dorukplays.com">dorukplays.com'a dön</a>`;
      panel.querySelector('[data-a=resume]')!.addEventListener('click', () => this.togglePause());
      panel.querySelector('[data-a=quit]')!.addEventListener('click', () => {
        this.dispose();
        this.onQuit();
      });
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      panel.classList.add('hidden');
      if (this.player.alive) panel.innerHTML = '';
      else this.showDeadPanel();
    }
  }

  private showDeadPanel(): void {
    const panel = this.hud.deadPanel;
    panel.classList.remove('hidden');
    panel.innerHTML = `<h2>İmha edildin</h2><p>Takımını izliyorsun.</p>
      <button class="ui-btn" data-a="speed">Hızlandır ×4</button>
      <button class="ui-btn primary" data-a="skip">Sonucu hemen gör</button>`;
    panel.querySelector('[data-a=speed]')!.addEventListener('click', (e) => {
      this.timeScale = this.timeScale === 1 ? 4 : 1;
      (e.target as HTMLElement).textContent = this.timeScale === 1 ? 'Hızlandır ×4' : 'Normal hız';
    });
    panel.querySelector('[data-a=skip]')!.addEventListener('click', () => this.fastForward());
  }

  /** Simulate the rest of the match without rendering. */
  private fastForward(): void {
    let guard = 0;
    while (!this.ended && guard++ < 20000) this.step(1 / 20, false);
    this.endTimer = 0;
  }

  frame(dtReal: number): void {
    if (this.paused) {
      this.render();
      return;
    }
    const dt = Math.min(0.05, dtReal) * this.timeScale;
    const sub = this.timeScale > 1 ? 4 : 1;
    for (let i = 0; i < sub; i++) this.step(dt / sub, true);
    if (this.ended) {
      this.endTimer -= dtReal;
      if (this.endTimer <= 0 && this.result) {
        const r = this.result;
        this.result = null;
        this.dispose();
        this.onEnd(r);
        return;
      }
    }
    this.updateCamera(dt);
    this.updateHud(dtReal);
    this.render();
  }

  private render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private step(dt: number, visual: boolean): void {
    this.time += dt;
    if (!this.ended) this.timeLeft -= dt;

    this.spotTimer -= dt;
    if (this.spotTimer <= 0) {
      this.spotTimer = 0.2;
      this.spotting();
    }

    if (visual) this.controlPlayer(dt);
    else {
      this.player.throttle = 0;
      this.player.steer = 0;
      this.player.wantFire = false;
    }
    for (const b of this.bots) b.update(dt, this);

    for (const t of this.tanks) {
      t.update(dt);
      if (t.alive && t.wantFire && t.canFire()) this.fire(t, visual);
    }
    this.separateTanks(visual);
    this.wallImpacts(visual);
    for (const t of this.tanks) {
      t.syncModel();
      if (visual) {
        updateDivineTrim(t.model, this.time);
        if (t.alive && t.model.root.visible) updateTrackAnim(t.model, t.speed, t.steer, dt);
        t.model.root.visible = t.spec.team === this.player.spec.team || this.visibleTo(this.player.spec.team, t);
      }
    }
    this.updateShells(dt, visual);
    if (visual) {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.08;
        for (const t of this.tanks) {
          if (t.alive && Math.abs(t.speed) > 3 && t.model.root.visible) {
            this.fx.dust(_v1.copy(t.pos).addScaledVector(t.forward, -t.dims.L * 0.45));
          }
          if (!t.alive && t.model.root.visible && Math.random() < 0.5) this.fx.smoke(t.center(_v1));
        }
      }
      this.fx.update(dt);
    }
    this.checkEnd();
  }

  /** Keeps tank footprints from overlapping and applies ramming damage. */
  private separateTanks(visual: boolean): void {
    for (let i = 0; i < this.tanks.length; i++) {
      for (let j = i + 1; j < this.tanks.length; j++) {
        const a = this.tanks[i];
        const b = this.tanks[j];
        if (!a.alive && !b.alive) continue;
        if (a.pos.distanceToSquared(b.pos) > 100) continue;
        const ra = a.rect();
        const push = rectOverlap(ra, b.rect());
        if (!push) continue;
        // Heavier tanks get pushed less; wrecks don't move.
        const ma = a.alive ? a.stats.mass : 1e6;
        const mb = b.alive ? b.stats.mass : 1e6;
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        a.pos.x += push.nx * push.depth * wa;
        a.pos.z += push.nz * push.depth * wa;
        b.pos.x -= push.nx * push.depth * wb;
        b.pos.z -= push.nz * push.depth * wb;

        // Ramming: closing speed along the contact normal (a -> b is -push).
        const fa = a.forward;
        const fb = b.forward;
        const tx = -push.nx;
        const tz = -push.nz;
        const closing = (fa.x * a.speed - fb.x * b.speed) * tx + (fa.z * a.speed - fb.z * b.speed) * tz;
        const key = a.id * 1000 + b.id;
        if (closing > RAM_MIN_SPEED && (this.ramCooldown.get(key) ?? 0) <= this.time && a.spec.team !== b.spec.team) {
          this.ramCooldown.set(key, this.time + 0.8);
          const energy = Math.pow(closing - 2, 1.5) * 6;
          const frontA = Math.max(0, fa.x * tx + fa.z * tz);
          const frontB = Math.max(0, -(fb.x * tx + fb.z * tz));
          const toB = Math.round(energy * a.stats.mass * a.stats.ramPower * (0.4 + 0.6 * frontA) * (1 - 0.5 * frontB));
          const toA = Math.round(energy * b.stats.mass * b.stats.ramPower * (0.4 + 0.6 * frontB) * (1 - 0.5 * frontA));
          const at = a.pos.clone().lerp(b.pos, 0.5);
          at.y += 1.2;
          if (a.alive && b.alive) {
            if (toB > 0) this.applyDamage(b, toB, a, at, visual);
            if (toA > 0) this.applyDamage(a, toA, b, at, visual);
          }
          if (visual) {
            this.fx.sparks(at, undefined, 24);
            sfx.blocked(this.nearness(at));
            if (a === this.player || b === this.player) {
              const dealt = a === this.player ? toB : toA;
              const taken = a === this.player ? toA : toB;
              this.hud.callout(`RAM! ${dealt}`, '#ffb347');
              this.hud.floatText(at, `-${dealt}`, '#ffb347', dealt > 300);
              if (taken > 0) this.hud.flashHit();
              this.shake = Math.max(this.shake, 0.6);
            }
          }
          a.speed *= 0.4;
          b.speed *= 0.4;
        } else {
          a.speed *= 0.95;
          b.speed *= 0.95;
        }
      }
    }
  }

  /** Damage from driving into walls, reported by each tank's physics step. */
  private wallImpacts(visual: boolean): void {
    for (const t of this.tanks) {
      if (t.wallImpact <= 0) continue;
      const dmg = t.wallImpact;
      t.wallImpact = 0;
      if (!t.alive) continue;
      const at = t.pos.clone().addScaledVector(t.forward, t.dims.L * 0.5);
      at.y += 1;
      this.applyDamage(t, dmg, t, at, visual);
      if (visual) {
        this.fx.sparks(at, undefined, 16);
        sfx.blocked(this.nearness(at));
        if (t === this.player) {
          this.hud.callout(`ÇARPIŞMA -${dmg}`, '#ff6b6b');
          this.hud.flashHit();
          this.shake = Math.max(this.shake, 0.5);
        }
      }
    }
  }

  private controlPlayer(dt: number): void {
    const p = this.player;
    const inp = this.input;
    const look = inp.consumeLook();
    if (inp.consumeZoom() && p.alive && !this.arty) {
      this.zoomed = !this.zoomed;
      this.resize();
    }
    if (inp.consumeArty() && p.alive && p.spec.cls === 'artillery') {
      this.arty = !this.arty;
      this.zoomed = false;
      this.resize();
      if (this.arty) {
        // start the target in front of the tank
        const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
        this.artyTarget.copy(p.pos).addScaledVector(f, 70);
      }
    }
    if (!p.alive) {
      p.wantFire = false;
      this.camYaw -= look.dx * 0.004;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - look.dy * 0.003, -0.5, 0.6);
      return;
    }

    if (this.arty) {
      // Move the impact point; tank holds still.
      const k = 0.12;
      const right = _v1.set(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
      const fwd = _v2.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
      this.artyTarget.addScaledVector(right, look.dx * k).addScaledVector(fwd, -look.dy * k);
      this.artyTarget.addScaledVector(right, inp.joyX * 40 * dt).addScaledVector(fwd, inp.joyY * 40 * dt);
      if (inp.usingKeys) {
        this.artyTarget.addScaledVector(right, inp.keySteer * 40 * dt).addScaledVector(fwd, inp.keyThrottle * 40 * dt);
      }
      this.artyTarget.x = THREE.MathUtils.clamp(this.artyTarget.x, -99, 99);
      this.artyTarget.z = THREE.MathUtils.clamp(this.artyTarget.z, -99, 99);
      this.artyTarget.y = heightAt(this.artyTarget.x, this.artyTarget.z);
      p.throttle = 0;
      p.steer = 0;
      p.aimYaw = Math.atan2(this.artyTarget.x - p.pos.x, this.artyTarget.z - p.pos.z);
      p.artyTarget = this.artyTarget;
      const pitch = this.artilleryPitch(p.muzzle(_v3), this.artyTarget, p.stats.shellSpeed);
      if (pitch !== null) p.aimPitch = pitch;
      this.lock = null;
      p.wantFire = inp.firing && pitch !== null;
      return;
    }

    const sens = this.zoomed ? 0.0035 / p.stats.zoom : 0.0045;
    this.camYaw -= look.dx * sens;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - look.dy * sens * 0.8, -0.35, 0.45);

    // Driving
    if (inp.usingKeys) {
      p.throttle = inp.keyThrottle;
      p.steer = -inp.keySteer;
    } else {
      const mag = Math.min(1, Math.hypot(inp.joyX, inp.joyY));
      if (mag > 0.01) {
        // Joystick is relative to the camera: up drives where you look.
        const want = this.camYaw + Math.atan2(-inp.joyX, inp.joyY);
        let diff = wrapAngle(want - p.yaw);
        let dir = 1;
        if (Math.abs(diff) > 2.2) {
          // target is behind: back up toward it
          diff = wrapAngle(diff + Math.PI);
          dir = -1;
        }
        p.steer = THREE.MathUtils.clamp(diff * 2.5, -1, 1) * dir;
        p.throttle = dir * mag * Math.max(0, Math.cos(diff));
      } else {
        p.throttle = 0;
        p.steer = 0;
      }
    }

    // Aim: ray from the camera center, with soft lock on visible enemies.
    this.camera.getWorldDirection(_v1);
    const camPos = this.camera.position;
    this.lock = this.zoomed ? null : this.findLock(camPos, _v1);
    if (this.lock) {
      this.lock.center(this.aimPoint);
    } else {
      const hit = this.raycastAll(camPos, _v1, 400, null);
      if (hit) this.aimPoint.copy(hit.point);
      else this.aimPoint.copy(camPos).addScaledVector(_v1, 400);
    }
    // Aim from the gun's pivot so the barrel line passes exactly through the aim point.
    const from = p.gunOrigin(_v2);
    p.aimYaw = Math.atan2(this.aimPoint.x - from.x, this.aimPoint.z - from.z);
    p.aimPitch = Math.atan2(this.aimPoint.y - from.y, Math.hypot(this.aimPoint.x - from.x, this.aimPoint.z - from.z));
    p.wantFire = inp.firing;
  }

  private findLock(origin: THREE.Vector3, dir: THREE.Vector3): Tank | null {
    const p = this.player;
    const maxAngle = this.zoomed ? 0.05 : 0.11;
    let best: Tank | null = null;
    let bestA = maxAngle;
    for (const e of this.tanks) {
      if (!e.alive || e.spec.team === p.spec.team || !this.visibleTo(p.spec.team, e)) continue;
      e.center(_v3).sub(origin);
      const d = _v3.length();
      if (d > 300) continue;
      const a = Math.acos(THREE.MathUtils.clamp(_v3.dot(dir) / d, -1, 1));
      if (a < bestA && lineOfSight(p.eye(_v2), e.center(new THREE.Vector3()))) {
        bestA = a;
        best = e;
      }
    }
    return best;
  }

  private raycastAll(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number, ignore: Tank | null) {
    let best: { t: number; point: THREE.Vector3; normal: THREE.Vector3; tank: Tank | null; hit?: ReturnType<Tank['raycast']> } | null = null;
    const s = raycastStatic(origin, dir, maxT);
    if (s) best = { ...s, tank: null };
    for (const t of this.tanks) {
      if (t === ignore || t === this.player) continue;
      const h = t.raycast(origin, dir, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = { t: h.t, point: h.point, normal: h.normal, tank: t, hit: h };
    }
    return best;
  }

  private fire(t: Tank, visual: boolean): void {
    const muzzle = t.muzzle(new THREE.Vector3());
    const dir = t.gunDir(new THREE.Vector3());
    // Random cone
    const disp = t.currentDispersion() * Math.sqrt(Math.random());
    const ang = Math.random() * Math.PI * 2;
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.cos(ang) * disp).addScaledVector(up2, Math.sin(ang) * disp).normalize();
    t.onFired();
    const isArty = t.stats.splash > 0;
    let speed = t.stats.shellSpeed;
    if (isArty && t.artyTarget) {
      // Speed for the gun's actual elevation, so the dispersion cone is what spreads the shot.
      const v = artillerySpeed(muzzle, t.artyTarget, Math.max(0.2, t.gunPitch));
      if (v !== null) speed = Math.min(v, t.stats.shellSpeed * 1.1);
    }
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat[t.spec.team === this.player.spec.team ? 0 : 1]);
    mesh.visible = visual;
    this.scene.add(mesh);
    this.shells.push({
      pos: muzzle.clone(),
      vel: dir.clone().multiplyScalar(speed),
      owner: t,
      gravity: isArty ? GRAVITY_ARTY : 0,
      life: isArty ? 12 : 3,
      mesh,
      pen: t.stats.pen,
      dmg: t.stats.damage,
      splash: t.stats.splash,
    });
    // Firing reveals you briefly to nearby enemies.
    const enemyTeam = (1 - t.spec.team) as 0 | 1;
    for (const e of this.tanks) {
      if (e.alive && e.spec.team === enemyTeam && e.pos.distanceTo(t.pos) < e.stats.view * 1.25) {
        const cur = this.visibleUntil[enemyTeam].get(t.id) ?? 0;
        this.visibleUntil[enemyTeam].set(t.id, Math.max(cur, this.time + 1.2));
        break;
      }
    }
    if (!visual) return;
    this.fx.muzzle(muzzle, dir);
    const near = this.nearness(muzzle);
    if (t === this.player) {
      sfx.fire(1);
      this.shake = Math.max(this.shake, 0.35);
    } else if (near > 0.05 && this.time - this.lastFireSound > 0.08) {
      sfx.fire(near * 0.6);
      this.lastFireSound = this.time;
    }
  }

  private nearness(p: THREE.Vector3): number {
    return Math.max(0, 1 - this.camera.position.distanceTo(p) / 160);
  }

  private updateShells(dt: number, visual: boolean): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      s.vel.y -= s.gravity * dt;
      const step = s.vel.length() * dt;
      const dir = _v1.copy(s.vel).normalize();
      let done = s.life <= 0;
      // nearest hit: static or tank
      let hitT = Infinity;
      let hitPoint: THREE.Vector3 | null = null;
      let hitTank: Tank | null = null;
      let tankHit: ReturnType<Tank['raycast']> = null;
      const st = raycastStatic(s.pos, dir, step);
      if (st) {
        hitT = st.t;
        hitPoint = st.point;
      }
      for (const t of this.tanks) {
        if (t === s.owner && s.life > (s.gravity ? 11.5 : 2.8)) continue; // don't hit yourself at the muzzle
        const h = t.raycast(s.pos, dir, Math.min(step, hitT));
        if (h && h.t < hitT) {
          hitT = h.t;
          hitPoint = h.point;
          hitTank = t;
          tankHit = h;
        }
      }
      if (hitPoint) {
        this.impact(s, dir.clone(), hitPoint, hitTank, tankHit, visual);
        done = true;
      } else {
        s.pos.addScaledVector(s.vel, dt);
        if (visual) {
          s.mesh.position.copy(s.pos);
          s.mesh.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), dir);
        }
      }
      if (done) {
        this.scene.remove(s.mesh);
        this.shells.splice(i, 1);
      }
    }
  }

  private impact(
    s: Shell,
    dir: THREE.Vector3,
    point: THREE.Vector3,
    target: Tank | null,
    h: ReturnType<Tank['raycast']>,
    visual: boolean,
  ): void {
    const byPlayer = s.owner === this.player;
    const near = this.nearness(point);
    if (target && h && target.alive) {
      const angle = Tank.impactAngle(dir, h.normal);
      const r = resolveHit(s.pen, s.dmg, h.thickness, angle, ricochetFor(target, h));
      // Front plates soak damage, the rear takes extra.
      let dmg = Math.round(r.damage * ZONES[h.zone].dmgMult);
      // HE (artillery) still hurts a bit without penetrating.
      if (s.splash > 0 && r.result !== 'pen') dmg = Math.max(0, Math.round(s.dmg * 0.35 - h.thickness * 0.8));
      // Module damage: tracks break on any non-ricochet hit; a penetrating rear hit may wreck the engine.
      let module = '';
      if (h.zone === 'track' && r.result !== 'ricochet') {
        target.trackedTimer = TRACK_STUN;
        module = 'track';
      }
      if (h.zone === 'rear' && r.result === 'pen' && !target.engineDamaged && Math.random() < ENGINE_DAMAGE_CHANCE) {
        target.engineDamaged = true;
        module = 'engine';
      }
      if (dmg > 0) this.applyDamage(target, dmg, s.owner, point, visual);
      if (visual && module) {
        const mine = target === this.player;
        if (mine || byPlayer) {
          const txt = module === 'track'
            ? (mine ? 'PALET HASARLI!' : 'PALET KOPTU!')
            : (mine ? 'MOTOR HASAR GÖRDÜ!' : 'MOTOR VURULDU!');
          setTimeout(() => this.hud.callout(txt, mine ? '#ff9a3c' : '#9affb8'), 450);
        }
      }
      if (visual) {
        if (r.result === 'pen' || s.splash > 0) this.fx.explosion(point, s.splash > 0 ? 1.4 : 0.6);
        else this.fx.sparks(point, new THREE.Color(r.result === 'ricochet' ? 0.6 : 1, 0.9, 1));
        if (byPlayer) {
          const map = {
            pen: ['DELDİ!', '#3ddc6a'],
            ricochet: ['SEKTİ', '#ffd34d'],
            blocked: ['DELEMEDİ', '#ff6b6b'],
          } as const;
          const [txt, col] = map[r.result];
          this.hud.callout(dmg > 0 && r.result !== 'pen' ? `HASAR ${dmg}` : txt, col);
          if (dmg > 0) this.hud.floatText(point, String(dmg), '#ffe066', dmg > 400);
        }
        if (target === this.player) {
          this.hud.flashHit();
          this.shake = Math.max(this.shake, dmg > 0 ? 0.6 : 0.25);
          if (r.result === 'ricochet') this.hud.callout('SEKTİRDİN!', '#33d6ff');
          else if (r.result === 'blocked' && dmg === 0) this.hud.callout('ZIRH DAYANDI', '#33d6ff');
        }
        if (r.result === 'pen') sfx.pen(near);
        else if (r.result === 'ricochet') sfx.ricochet(near);
        else sfx.blocked(near);
      }
    } else if (visual) {
      if (s.splash > 0) {
        this.fx.explosion(point, 1.3);
        sfx.explode(near * 0.8);
      } else {
        this.fx.sparks(point, undefined, 8);
      }
    }
    if (s.splash > 0) {
      for (const t of this.tanks) {
        if (!t.alive || t === target) continue;
        const d = t.center(_v3).distanceTo(point);
        if (d > s.splash) continue;
        const dmg = Math.round(s.dmg * 0.4 * (1 - d / s.splash) - t.stats.hullArmor.rear * 0.25);
        if (dmg > 0) this.applyDamage(t, dmg, s.owner, _v3.clone(), visual);
      }
    }
  }

  private applyDamage(t: Tank, dmg: number, from: Tank, at: THREE.Vector3, visual: boolean): void {
    const killed = t.damage(dmg, from);
    if (t.spec.team !== from.spec.team) {
      // the shooter is revealed to the victim's team for a moment
      const team = t.spec.team;
      const cur = this.visibleUntil[team].get(from.id) ?? 0;
      this.visibleUntil[team].set(from.id, Math.max(cur, this.time + 1.5));
    }
    if (visual && from === this.player && t !== this.player && !killed) {
      // floaters are handled by impact for direct hits; splash shows here
      if (from.stats.splash > 0) this.hud.floatText(at, String(dmg), '#ffe066');
    }
    if (killed) {
      if (visual) {
        this.fx.explosion(t.center(_v3), 2.2);
        sfx.explode(this.nearness(t.pos));
        if (t === this.player) {
          this.zoomed = false;
          this.arty = false;
          this.resize();
          this.showDeadPanel();
        }
        if (from === this.player) this.hud.callout('İMHA!', '#ff4a4a');
        this.hud.killFeed(from, t, this.player.spec.team);
      }
    }
  }

  private checkEnd(): void {
    if (this.ended) return;
    const alive = [0, 1].map((team) => this.tanks.filter((t) => t.alive && t.spec.team === team).length);
    let winner: number | null = null;
    let draw = false;
    if (alive[0] === 0 && alive[1] === 0) draw = true;
    else if (alive[1] === 0) winner = 0;
    else if (alive[0] === 0) winner = 1;
    else if (this.timeLeft <= 0) {
      const hp = [0, 1].map((team) =>
        this.tanks.filter((t) => t.spec.team === team).reduce((s, t) => s + t.hp / t.stats.hp, 0),
      );
      if (Math.abs(hp[0] - hp[1]) < 0.01) draw = true;
      else winner = hp[0] > hp[1] ? 0 : 1;
    }
    if (winner === null && !draw) return;
    this.ended = true;
    this.endTimer = 2.8;
    const win = winner === this.player.spec.team;
    this.result = {
      win,
      draw,
      damage: Math.round(this.player.damageDealt),
      kills: this.player.kills,
      survived: this.player.alive,
    };
    this.hud.callout(draw ? 'BERABERE' : win ? 'ZAFER!' : 'YENİLGİ', draw ? '#ffffff' : win ? '#3ddc6a' : '#ff4a4a');
    this.hud.deadPanel.classList.add('hidden');
    this.timeScale = 1;
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    let focus = p;
    if (!p.alive) {
      if (!this.spectate || !this.spectate.alive) {
        this.spectate = this.tanks.find((t) => t.alive && t.spec.team === p.spec.team) ?? p;
        if (this.spectate !== p) this.camYaw = this.spectate.turretYaw;
      }
      focus = this.spectate;
    }
    const shakeAmt = this.shake * this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const jitter = () => (Math.random() - 0.5) * shakeAmt * 0.6;

    if (this.arty && p.alive) {
      this.artyRing.visible = true;
      const dist = p.pos.distanceTo(this.artyTarget);
      const r = Math.max(1.5, p.currentDispersion() * dist + 1);
      this.artyRing.scale.set(r, r, 1);
      this.artyRing.position.set(this.artyTarget.x, this.artyTarget.y + 0.3, this.artyTarget.z);
      const inRange = this.artilleryPitch(p.muzzle(_v1), this.artyTarget, p.stats.shellSpeed) !== null;
      (this.artyRing.material as THREE.MeshBasicMaterial).color.set(inRange ? (p.aim > 0.95 ? 0x3ddc6a : 0xffd34d) : 0xff3b3b);
      const back = _v2.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).multiplyScalar(-14);
      this.camera.position.set(this.artyTarget.x + back.x + jitter(), this.artyTarget.y + 85, this.artyTarget.z + back.z + jitter());
      this.camera.lookAt(this.artyTarget);
      return;
    }
    this.artyRing.visible = false;

    const dir = _v1.set(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    );
    const pivot = _v2.set(focus.pos.x, focus.pos.y + focus.dims.H + focus.dims.tH + 1.0, focus.pos.z);
    let camPos: THREE.Vector3;
    if (this.zoomed && p.alive) {
      camPos = pivot.clone().addScaledVector(dir, 1.5);
      camPos.y += 0.3;
    } else {
      const portrait = window.innerHeight > window.innerWidth;
      const dist = (focus.dims.L * 1.1 + 4) * (portrait ? 1.1 : 1);
      camPos = pivot.clone().addScaledVector(dir, -dist);
      camPos.y += portrait ? 4.2 : 2.8;
      // keep the camera out of walls and terrain
      const toCam = camPos.clone().sub(pivot);
      const len = toCam.length();
      toCam.divideScalar(len);
      const block = raycastStatic(pivot, toCam, len);
      if (block) camPos.copy(pivot).addScaledVector(toCam, Math.max(1.5, block.t - 0.6));
      camPos.y = Math.max(camPos.y, heightAt(camPos.x, camPos.z) + 0.8);
    }
    this.camera.position.set(camPos.x + jitter(), camPos.y + jitter(), camPos.z + jitter());
    const lookAt = pivot.clone().addScaledVector(dir, 40);
    lookAt.y += this.zoomed ? 0 : window.innerHeight > window.innerWidth ? 0.8 : -2.5;
    this.camera.lookAt(lookAt);
  }

  private updateHud(dt: number): void {
    const p = this.player;
    let status = '';
    let color = '#ffffff';
    if (!p.alive) {
      status = 'İMHA EDİLDİ';
      color = '#ff4a4a';
    } else if (p.reloadLeft > 0 && p.ammo <= 0) {
      status = `DOLDURULUYOR ${p.reloadLeft.toFixed(1)}s`;
      color = '#ffc531';
    } else if (p.reloadLeft > 0) {
      status = `SIRADAKİ ${p.reloadLeft.toFixed(1)}s`;
      color = '#ffc531';
    } else if (this.arty) {
      const ok = this.artilleryPitch(p.muzzle(_v1), this.artyTarget, p.stats.shellSpeed) !== null;
      status = ok ? `NİŞAN ${Math.round(p.aim * 100)}%` : 'MENZİL DIŞI';
      color = ok ? '#ffffff' : '#ff6b6b';
    } else if (this.lock && !lineOfSight(p.muzzle(_v1), this.lock.center(_v2))) {
      status = 'ENGELLİ';
      color = '#ff6b6b';
    } else {
      status = `NİŞAN ${Math.round(p.aim * 100)}%`;
      color = p.aim > 0.95 ? '#3ddc6a' : '#ffffff';
    }

    // Where the gun really points right now (shells follow this line, not the screen center).
    let gunScreen: { x: number; y: number } | null = null;
    let ringPx = 0;
    let analysis: ShotEstimate | null = null;
    if (p.alive && !this.arty) {
      const origin = p.gunOrigin(_v1);
      const dir = p.gunDir(_v2);
      const hit = this.raycastAll(origin, dir, 400, p);
      const gp = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, 400);
      const sp = gp.clone().project(this.camera);
      if (sp.z < 1) gunScreen = { x: (sp.x * 0.5 + 0.5) * window.innerWidth, y: (-sp.y * 0.5 + 0.5) * window.innerHeight };
      const focal = window.innerHeight / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
      ringPx = Math.max(14, 2 * Math.tan(p.currentDispersion()) * focal);
      if (hit?.tank && hit.hit && hit.tank.alive && hit.tank.spec.team !== p.spec.team) {
        analysis = estimateShot(p, hit.tank, dir, hit.hit);
      }
    }
    if (this.zoomed) this.updateWeakSpots(dt);
    else this.hideWeakSpots();
    this.hud.update(
      {
        timeLeft: this.timeLeft,
        player: p,
        tanks: this.tanks,
        visible: (t) => this.visibleTo(p.spec.team, t),
        camera: this.camera,
        status,
        statusColor: color,
        lock: this.lock,
        analysis,
        gunScreen,
        ringPx,
        zoomed: this.zoomed,
        arty: this.arty,
        spectating: p.alive ? null : this.spectate,
      },
      dt,
      window.innerWidth,
      window.innerHeight,
    );
  }

  private weakTimer = 0;

  /** While zoomed, light up enemy weak spots colored by how likely you are to pen them. */
  private updateWeakSpots(dt: number): void {
    this.weakTimer -= dt;
    if (this.weakTimer > 0) return;
    this.weakTimer = 0.15;
    const p = this.player;
    const origin = p.gunOrigin(new THREE.Vector3());
    for (const e of this.tanks) {
      const enemy = e.spec.team !== p.spec.team && e.alive && this.visibleTo(p.spec.team, e);
      for (const [zone, mesh] of Object.entries(e.model.weak) as [ArmorZone, THREE.Mesh][]) {
        if (!enemy) {
          mesh.visible = false;
          continue;
        }
        const target = e.weakSpotPoint(zone);
        const dir = target.clone().sub(origin).normalize();
        const h = e.raycast(origin, dir, 500);
        // Only show spots that face you (the ray actually lands on that zone).
        if (!h || h.zone !== zone) {
          mesh.visible = false;
          continue;
        }
        const est = estimateShot(p, e, dir, h);
        mesh.visible = true;
        (mesh.material as THREE.MeshBasicMaterial).color.set(chanceColor(est.chance));
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(this.time * 6) ** 2;
      }
    }
  }

  private hideWeakSpots(): void {
    for (const e of this.tanks) for (const m of Object.values(e.model.weak)) m.visible = false;
  }

  dispose(): void {
    this.input.dispose();
    this.hud.dispose();
    this.fx.dispose();
    this.composer?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
  }
}

export interface ShotEstimate {
  /** Estimated chance to penetrate (0..1), as accurate as the shooter's optic. */
  chance: number;
  /** Estimated damage if it penetrates. */
  damage: number;
  zone: string;
}

/** Stable pseudo-random value in [-1, 1] for a target and zone, so estimates don't flicker. */
function stableNoise(a: number, b: string): number {
  let h = a * 2654435761;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b.charCodeAt(i), 16777619);
  return (((h >>> 0) % 2001) / 1000) - 1;
}

/** What the shooter's optic reports for a hit: better optics give closer-to-true numbers. */
function estimateShot(shooter: Tank, target: Tank, dir: THREE.Vector3, h: TankHit): ShotEstimate {
  const s = shooter.stats;
  const a = analyzeShot(s.pen, s.damage, h.thickness, Tank.impactAngle(dir, h.normal), ricochetFor(target, h));
  const err = OPTIC_ERROR[s.opticLevel] ?? OPTIC_ERROR[0];
  const step = s.opticLevel === 0 ? 0.1 : s.opticLevel < 3 ? 0.05 : 0.01;
  const chance = Math.max(0, Math.min(1, Math.round((a.chance + stableNoise(target.id, h.zone) * err) / step) * step));
  const trueDmg = s.damage * ZONES[h.zone].dmgMult;
  const damage = Math.round(trueDmg * (1 + stableNoise(target.id * 7 + 3, h.zone) * err));
  return { chance, damage, zone: ZONES[h.zone].name };
}

/** Target's sektirme stat for a given plate (Front Armor part boosts the front hull). */
function ricochetFor(t: Tank, h: { zone: ArmorZone }): number {
  const front = h.zone === 'upperFront' || h.zone === 'lowerFront' ? t.stats.frontRicochet : 0;
  return Math.min(0.95, t.stats.ricochet + ZONES[h.zone].ricochetBonus + front);
}

/** Bots roll close to the player's rarity so matches stay fair. */
function botRarity(player: Rarity): Rarity {
  const i = rarityIndex(player) + Math.round((Math.random() - 0.5) * 2.4);
  return RARITIES[Math.max(0, Math.min(RARITIES.length - 1, i))];
}
