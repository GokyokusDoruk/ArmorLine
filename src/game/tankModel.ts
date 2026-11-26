import * as THREE from 'three';
import { RARITY_INFO, type Rarity } from '../data/rarity';
import { NATION_INFO, type Nation, type TankClass } from '../data/tanks';

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
  for (const s of [-1, 1]) {
    const x = s * (d.W / 2 - trackW / 2);
    body.add(box(trackW, trackH, d.L, darkMat, x, trackH / 2, 0));
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
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(d.barrelR, d.barrelR * 1.15, d.barrel, 10), metalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = d.barrel / 2;
  gun.add(barrel);
  const mantlet = box(d.barrelR * 4, d.barrelR * 4, 0.6, paint2, 0, 0, 0.2);
  gun.add(mantlet);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(d.barrelR * 1.6, d.barrelR * 1.6, 0.5, 8), metalMat);
  brake.rotation.x = Math.PI / 2;
  brake.position.z = d.barrel - 0.1;
  gun.add(brake);
  const muzzle = new THREE.Object3D();
  muzzle.position.z = d.barrel + 0.3;
  gun.add(muzzle);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });

  return { root, body, turret, gun, muzzle, trim, paint: [paint, paint2], divine: rarity === 'divine' };
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
  m.divine = false;
  m.turret.rotation.z = 0.25;
  m.turret.position.y += 0.3;
}
