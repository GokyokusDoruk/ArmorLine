import * as THREE from 'three';
import { RARITY_INFO, type Rarity } from '../data/rarity';
import { CLASSES, NATION_INFO, type Nation, type TankClass } from '../data/tanks';
import { cloneTemplate, getTemplate } from './models';

export interface TankDims {
  /** Hull length (z), width (x), height (y). */
  L: number;
  W: number;
  H: number;
  /** Turret size and position along z. */
  tL: number;
  tW: number;
  tH: number;
  tZ: number;
  barrel: number;
  barrelR: number;
  radius: number;
}

export const DIMS: Record<TankClass, TankDims> = {
  heavy: { L: 7.0, W: 3.8, H: 1.7, tL: 3.4, tW: 3.0, tH: 1.3, tZ: -0.3, barrel: 4.6, barrelR: 0.2, radius: 3.3 },
  mobile: { L: 5.6, W: 3.1, H: 1.15, tL: 2.4, tW: 2.2, tH: 0.9, tZ: -0.2, barrel: 3.4, barrelR: 0.13, radius: 2.7 },
  sniper: { L: 6.6, W: 3.3, H: 1.25, tL: 2.6, tW: 2.4, tH: 0.95, tZ: -0.8, barrel: 6.2, barrelR: 0.14, radius: 3.0 },
  artillery: { L: 6.4, W: 3.4, H: 1.35, tL: 3.2, tW: 3.0, tH: 1.5, tZ: -1.2, barrel: 4.0, barrelR: 0.28, radius: 3.0 },
};

export interface TankModel {
  root: THREE.Group;
  body: THREE.Group;
  turret: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Object3D;
  trim: THREE.MeshBasicMaterial;
  paint: THREE.MeshStandardMaterial[];
  divine: boolean;
  /** Weak-spot overlays, shown to the player while zoomed. */
  weak: Record<WeakZone, THREE.Mesh>;
  /** Part of the gun that slides back on recoil. */
  recoil?: THREE.Object3D;
  /** Electric shield dome (hidden unless the tank has a shield). */
  shield?: THREE.Mesh;
  /** Track meshes per side (local -x = left, +x = right), hidden when the track breaks. */
  tracks: { left: THREE.Object3D[]; right: THREE.Object3D[] };
  /** Track animation (GLB models only). */
  anim?: { mixer: THREE.AnimationMixer; fwd: THREE.AnimationAction; back: THREE.AnimationAction; left: THREE.AnimationAction; right: THREE.AnimationAction };
}

/** After the GLB models load, size the hitboxes to match them. */
export function applyModelDims(): void {
  for (const cls of CLASSES) {
    const t = getTemplate(cls);
    if (!t) continue;
    const m = t.measure;
    const d = DIMS[cls];
    d.L = m.L;
    d.W = m.W;
    d.H = m.H / 0.95;
    d.tL = m.tL;
    d.tW = m.tW;
    d.tH = m.tH;
    d.tZ = m.tZ;
    d.barrel = m.barrel;
    d.radius = Math.max(m.L, m.W) / 2;
  }
}

/** Rarity trim strips and weak-spot overlays shared by both model kinds. */
function addTrimAndWeak(body: THREE.Group, turret: THREE.Group, d: TankDims, trim: THREE.Material): Record<WeakZone, THREE.Mesh> {
  for (const s of [-1, 1]) {
    body.add(box(0.08, 0.12, d.L * 0.8, trim, s * (d.W / 2 + 0.02), d.H * 0.55, 0));
  }
  turret.add(box(d.tW * 0.9, 0.08, 0.08, trim, 0, d.tH * 0.7, -d.tL / 2 - 0.03));
  const lowerFront = weakMesh(d.W * 0.86, d.H * 0.36, 0.12);
  lowerFront.position.set(0, d.H * 0.2, d.L / 2 + 0.05);
  body.add(lowerFront);
  const rear = weakMesh(d.W * 0.8, d.H * 0.5, 0.12);
  rear.position.set(0, d.H * 0.45, -d.L / 2 - 0.05);
  body.add(rear);
  const cupola = weakMesh(d.tW * 0.6, d.tH * 0.32, d.tL * 0.6);
  cupola.position.set(0, d.tH * 0.86, -d.tL * 0.05);
  turret.add(cupola);
  const loader = weakMesh(d.tW * 0.7, d.tH * 0.5, 0.12);
  loader.position.set(0, d.tH * 0.45, -d.tL / 2 - 0.06);
  turret.add(loader);
  const fuelL = weakMesh(0.12, d.H * 0.4, d.L * 0.22);
  fuelL.position.set(-d.W / 2 - 0.06, d.H * 0.72, -d.L * 0.38);
  body.add(fuelL);
  const fuelR = weakMesh(0.12, d.H * 0.4, d.L * 0.22);
  fuelR.position.set(d.W / 2 + 0.06, d.H * 0.72, -d.L * 0.38);
  body.add(fuelR);
  return { lowerFront, rear, cupola, loader, fuelL, fuelR };
}

/** Electric shield: a wireframe dome plus a faint shell, additive so it glows. */
function shieldDome(d: TankDims): THREE.Mesh {
  const r = Math.max(d.L, d.W) * 0.62;
  const mat = new THREE.MeshBasicMaterial({
    color: 0x66e0ff, transparent: true, opacity: 0, wireframe: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat);
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.99, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x2a8cff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  dome.add(shell);
  // the shell follows the dome's opacity
  shell.onBeforeRender = () => {
    (shell.material as THREE.MeshBasicMaterial).opacity = mat.opacity * 0.35;
  };
  dome.scale.y = 0.7;
  dome.position.y = d.H * 0.6;
  dome.visible = false;
  dome.renderOrder = 6;
  return dome;
}

/** Builds a tank from the CC0 GLB model, painted in the nation's colors. */
function buildGlbModel(nation: Nation, cls: TankClass, rarity: Rarity): TankModel | null {
  const inst = cloneTemplate(cls);
  if (!inst) return null;
  const d = DIMS[cls];
  const [bodyColor] = NATION_INFO[nation].colors;
  const base = new THREE.Color(bodyColor);
  const tints: Record<string, THREE.Color> = {
    Main: base.clone(),
    Main_Light: base.clone().multiplyScalar(1.3),
    Main_Dark: base.clone().multiplyScalar(0.65),
    Main_Details: new THREE.Color(0x2e3238),
  };
  const paint: THREE.MeshStandardMaterial[] = [];
  const cache = new Map<THREE.Material, THREE.Material>();
  inst.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      let c = cache.get(m);
      if (!c) {
        c = m.clone();
        const std = c as THREE.MeshStandardMaterial;
        const tint = tints[m.name];
        if (tint && std.color) std.color.copy(tint);
        if (std.isMeshStandardMaterial) {
          std.metalness = Math.min(std.metalness, 0.2);
          paint.push(std);
        }
        cache.set(m, c);
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });

  const root = new THREE.Group();
  const body = inst.root as THREE.Group;
  root.add(body);
  const turret = body.getObjectByName('al_turret') as THREE.Group;
  const gun = body.getObjectByName('al_gun') as THREE.Group;
  const muzzle = body.getObjectByName('al_muzzle')!;
  const rc = RARITY_INFO[rarity].color;
  const trim = new THREE.MeshBasicMaterial({ color: rarity === 'divine' ? 0xffffff : new THREE.Color(rc) });
  const weak = addTrimAndWeak(body, turret, d, trim);
  const shield = shieldDome(d);
  root.add(shield);
  const recoil = gun.children.find((c) => c !== muzzle);
  const tracks = { left: [] as THREE.Object3D[], right: [] as THREE.Object3D[] };
  body.traverse((o) => {
    if (o.name.toLowerCase().startsWith('trackmesh')) {
      const c = new THREE.Box3().setFromObject(o, false).getCenter(new THREE.Vector3());
      (c.x < 0 ? tracks.left : tracks.right).push(o);
    }
  });

  const mixer = new THREE.AnimationMixer(body);
  const clip = (n: string) => inst.clips.find((c) => c.name.includes(n));
  const act = (n: string) => {
    const c = clip(n);
    const a = mixer.clipAction(c ?? new THREE.AnimationClip(n, 0, []));
    a.play();
    a.setEffectiveWeight(0);
    return a;
  };
  const anim = { mixer, fwd: act('Forward'), back: act('Backwards'), left: act('TurningLeft'), right: act('TurningRight') };
  return { root, body, turret, gun, muzzle, trim, paint, divine: rarity === 'divine', weak, anim, recoil, shield, tracks };
}

/** Blend track animations by speed and turning. */
export function updateTrackAnim(m: TankModel, speed: number, turn: number, dt: number): void {
  const a = m.anim;
  if (!a) return;
  const k = Math.min(1, Math.abs(speed) / 6);
  a.fwd.setEffectiveWeight(speed > 0.2 ? k : 0);
  a.back.setEffectiveWeight(speed < -0.2 ? k : 0);
  const still = Math.abs(speed) < 0.2;
  a.left.setEffectiveWeight(still && turn > 0.05 ? 1 : 0);
  a.right.setEffectiveWeight(still && turn < -0.05 ? 1 : 0);
  a.mixer.update(dt * (0.5 + k));
}

export type WeakZone = 'lowerFront' | 'rear' | 'cupola' | 'loader' | 'fuelL' | 'fuelR';

function weakMesh(w: number, h: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  m.visible = false;
  m.renderOrder = 4;
  return m;
}

const darkMat = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.9, metalness: 0.05 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a515e, roughness: 0.5, metalness: 0.25 });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A sloped front plate: a box rotated around x. */
function slope(w: number, len: number, angle: number, mat: THREE.Material, y: number, z: number): THREE.Mesh {
  const m = box(w, 0.25, len, mat);
  m.rotation.x = angle;
  m.position.set(0, y, z);
  return m;
}

export function buildTankModel(nation: Nation, cls: TankClass, rarity: Rarity): TankModel {
  return buildGlbModel(nation, cls, rarity) ?? buildBoxModel(nation, cls, rarity);
}

/** Fallback tank made of boxes (used if the GLB models can't load). */
function buildBoxModel(nation: Nation, cls: TankClass, rarity: Rarity): TankModel {
  const d = DIMS[cls];
  const [bodyColor, accent] = NATION_INFO[nation].colors;
  const paint = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6, metalness: 0.12 });
  const paint2 = new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor).multiplyScalar(0.8), roughness: 0.65, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.3, emissive: accent, emissiveIntensity: 0.25 });
  const rc = RARITY_INFO[rarity].color;
  const trim = new THREE.MeshBasicMaterial({ color: rarity === 'divine' ? 0xffffff : new THREE.Color(rc) });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Tracks
  const trackW = d.W * 0.24;
  const trackH = d.H * 0.75;
  const tracks = { left: [] as THREE.Object3D[], right: [] as THREE.Object3D[] };
  for (const s of [-1, 1]) {
    const x = s * (d.W / 2 - trackW / 2);
    const tr = box(trackW, trackH, d.L, darkMat, x, trackH / 2, 0);
    body.add(tr);
    (s < 0 ? tracks.left : tracks.right).push(tr);
    // wheels
    const n = cls === 'mobile' ? 4 : 5;
    for (let i = 0; i < n; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(trackH * 0.36, trackH * 0.36, trackW * 1.05, 10), metalMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, trackH * 0.4, -d.L / 2 + 0.6 + (i * (d.L - 1.2)) / (n - 1));
      body.add(wheel);
    }
    // fender + rarity trim strip
    body.add(box(trackW * 1.1, 0.12, d.L * 1.02, paint2, x, trackH + 0.05, 0));
    body.add(box(0.08, 0.1, d.L * 0.9, trim, x + s * trackW * 0.56, trackH * 0.7, 0));
  }

  // Hull
  const hullW = d.W - trackW * 1.6;
  const hullH = d.H * 0.7;
  const hullY = trackH * 0.45 + hullH / 2;
  body.add(box(hullW, hullH, d.L * 0.82, paint, 0, hullY, -d.L * 0.05));
  body.add(slope(hullW, d.L * 0.24, -0.55, paint, hullY + hullH * 0.12, d.L * 0.4));
  // engine deck grill + accent stripe
  body.add(box(hullW * 0.7, 0.08, d.L * 0.22, darkMat, 0, hullY + hullH / 2 + 0.04, -d.L * 0.32));
  body.add(box(hullW * 1.01, 0.1, 0.25, accentMat, 0, hullY + hullH * 0.2, d.L * 0.36));
  // headlights
  for (const s of [-1, 1]) {
    const l = box(0.3, 0.18, 0.1, new THREE.MeshBasicMaterial({ color: 0xcff4ff }), s * hullW * 0.35, hullY + hullH * 0.1, d.L * 0.47);
    body.add(l);
  }
  if (cls === 'heavy') {
    // extra applique armor
    for (const s of [-1, 1]) body.add(box(0.25, hullH * 0.8, d.L * 0.5, paint2, s * (hullW / 2 + 0.1), hullY, 0.4));
  }

  // Turret
  const turret = new THREE.Group();
  turret.position.set(0, hullY + hullH / 2, d.tZ);
  body.add(turret);
  if (cls === 'artillery') {
    // open-top casemate
    turret.add(box(d.tW, d.tH, d.tL, paint, 0, d.tH / 2, 0));
    turret.add(box(d.tW * 0.8, 0.1, d.tL * 0.8, darkMat, 0, d.tH + 0.01, 0));
  } else if (cls === 'mobile') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(d.tW * 0.42, d.tW * 0.5, d.tH, 8), paint);
    t.position.y = d.tH / 2;
    turret.add(t);
  } else {
    turret.add(box(d.tW, d.tH, d.tL, paint, 0, d.tH / 2, 0));
    const front = slope(d.tW * 0.95, d.tH * 0.9, -0.9, paint2, d.tH * 0.5, d.tL / 2 + 0.15);
    turret.add(front);
    turret.add(box(d.tW * 0.5, 0.4, d.tL * 0.5, paint2, -d.tW * 0.15, d.tH + 0.2, -d.tL * 0.1)); // cupola
  }
  turret.add(box(d.tW * 1.02, 0.08, 0.1, trim, 0, d.tH * 0.75, -d.tL / 2 + 0.06));
  // antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 4), metalMat);
  ant.position.set(d.tW * 0.35, d.tH + 1.1, -d.tL * 0.35);
  turret.add(ant);

  // Gun
  const gun = new THREE.Group();
  gun.position.set(0, d.tH * 0.55, cls === 'artillery' ? d.tL * 0.3 : d.tL / 2);
  turret.add(gun);
  const recoil = new THREE.Group();
  gun.add(recoil);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(d.barrelR, d.barrelR * 1.15, d.barrel, 10), metalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = d.barrel / 2;
  recoil.add(barrel);
  const mantlet = box(d.barrelR * 4, d.barrelR * 4, 0.6, paint2, 0, 0, 0.2);
  gun.add(mantlet);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(d.barrelR * 1.6, d.barrelR * 1.6, 0.5, 8), metalMat);
  brake.rotation.x = Math.PI / 2;
  brake.position.z = d.barrel - 0.1;
  recoil.add(brake);
  const muzzle = new THREE.Object3D();
  muzzle.position.z = d.barrel + 0.3;
  gun.add(muzzle);

  const weak = addTrimAndWeak(body, turret, d, trim);
  const shield = shieldDome(d);
  root.add(shield);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });

  return {
    root, body, turret, gun, muzzle, trim, paint: [paint, paint2], divine: rarity === 'divine',
    weak, recoil, shield, tracks,
  };
}

export function updateDivineTrim(m: TankModel, time: number): void {
  if (m.divine) m.trim.color.setHSL((time * 0.25) % 1, 1, 0.6);
}

export function setDestroyedLook(m: TankModel): void {
  for (const p of m.paint) {
    p.color.multiplyScalar(0.25);
    p.emissive?.setHex(0x000000);
  }
  m.trim.color.setHex(0x222222);
  for (const w of Object.values(m.weak)) w.visible = false;
  if (m.anim) m.anim.mixer.stopAllAction();
  m.divine = false;
  m.turret.rotation.z = 0.25;
  m.turret.position.y += 0.3;
}
