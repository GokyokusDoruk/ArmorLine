import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CLASSES, type TankClass } from '../data/tanks';
import heavyUrl from '../assets/models/heavy.glb?url';
import mobileUrl from '../assets/models/mobile.glb?url';
import sniperUrl from '../assets/models/sniper.glb?url';
import artilleryUrl from '../assets/models/artillery.glb?url';

/**
 * Tank meshes: "Animated Tank Pack" by Quaternius (CC0, https://poly.pizza/bundle/Animated-Tank-Pack-0tfvbeAJkU).
 * Each file is normalized once into a template: forward = +Z, sitting on y = 0, scaled to the class length,
 * with the turret and gun moved under pivot groups so the game can traverse and elevate them.
 */
const URLS: Record<TankClass, string> = {
  heavy: heavyUrl,
  mobile: mobileUrl,
  sniper: sniperUrl,
  artillery: artilleryUrl,
};

/** Max hull length and width per class in game units; the model keeps its proportions and fits inside. */
const TARGET: Record<TankClass, { L: number; W: number }> = {
  heavy: { L: 7.2, W: 4.0 },
  mobile: { L: 5.8, W: 3.1 },
  sniper: { L: 6.8, W: 3.4 },
  artillery: { L: 6.6, W: 3.5 },
};

export interface ModelMeasure {
  L: number;
  W: number;
  /** Hull height (top of the hull under the turret). */
  H: number;
  tL: number;
  tW: number;
  tH: number;
  /** Turret center along the hull's forward axis. */
  tZ: number;
  /** Distance from the gun pivot to the muzzle. */
  barrel: number;
}

export interface TankTemplate {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  measure: ModelMeasure;
}

const templates: Partial<Record<TankClass, TankTemplate>> = {};
if (import.meta.env.DEV) (window as unknown as { __tankTemplates: typeof templates }).__tankTemplates = templates;
let loading: Promise<boolean> | null = null;

export function modelsReady(): boolean {
  return CLASSES.every((c) => templates[c]);
}

export function getTemplate(cls: TankClass): TankTemplate | undefined {
  return templates[cls];
}

/** Loads all tank models once. Resolves false if anything failed (the game then uses simple box tanks). */
export function loadTankModels(): Promise<boolean> {
  if (!loading) {
    const loader = new GLTFLoader();
    loading = Promise.all(
      CLASSES.map(async (cls) => {
        const gltf = await loader.loadAsync(URLS[cls]);
        templates[cls] = normalize(gltf.scene, gltf.animations, cls);
      }),
    )
      .then(() => true)
      .catch((err) => {
        console.warn('Tank models failed to load, using simple tanks.', err);
        return false;
      });
  }
  return loading;
}

/** Finds a model part by name prefix (parts may be a group of several meshes, e.g. Tank_Turret_1, _2). */
function findPart(root: THREE.Object3D, part: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && o.name.toLowerCase().startsWith(part)) found = o;
  });
  return found;
}

/**
 * World-space bounds of a part in its rest pose. We measure each mesh's own geometry box through its
 * world matrix: SkinnedMesh bounds depend on bone matrices that are only refreshed at render time.
 */
function boxOf(o: THREE.Object3D): THREE.Box3 {
  o.updateWorldMatrix(true, true);
  const out = new THREE.Box3();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    out.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  });
  return out;
}

function normalize(src: THREE.Group, clips: THREE.AnimationClip[], cls: TankClass): TankTemplate {
  const root = new THREE.Group();
  const orient = new THREE.Group();
  root.add(orient);
  orient.add(src);

  const turretMesh = findPart(src, 'tank_turret');
  const gunMesh = findPart(src, 'tank_gun');
  const bodyMesh = findPart(src, 'tank_body');
  if (!turretMesh || !gunMesh || !bodyMesh) throw new Error(`model ${cls}: missing parts`);

  // 1) Which way does the gun point? Use the gun's offset from the turret center.
  const tb0 = boxOf(turretMesh).getCenter(new THREE.Vector3());
  const gb0 = boxOf(gunMesh);
  const gc0 = gb0.getCenter(new THREE.Vector3());
  const dx = gc0.x - tb0.x;
  const dz = gc0.z - tb0.z;
  // Rotate so that direction becomes +Z.
  orient.rotation.y = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? -Math.PI / 2 : Math.PI / 2) : dz > 0 ? 0 : Math.PI;

  // 2) Scale to the class length and stand on the ground, centered.
  let all = boxOf(root);
  const size = all.getSize(new THREE.Vector3());
  const s = Math.min(TARGET[cls].L / size.z, TARGET[cls].W / size.x);
  orient.scale.setScalar(s);
  all = boxOf(root);
  const c = all.getCenter(new THREE.Vector3());
  orient.position.set(-c.x, -all.min.y, -c.z);
  all = boxOf(root);

  // 3) Pivots: turret yaws around its own center; the gun pitches around its rear end.
  const tBox = boxOf(turretMesh);
  const tCenter = tBox.getCenter(new THREE.Vector3());
  const tSize = tBox.getSize(new THREE.Vector3());
  const turret = new THREE.Group();
  turret.name = 'al_turret';
  turret.position.set(tCenter.x, tBox.min.y, tCenter.z);
  root.add(turret);
  root.updateMatrixWorld(true);
  turret.attach(turretMesh);

  const gBox = boxOf(gunMesh);
  const gun = new THREE.Group();
  gun.name = 'al_gun';
  const pivotZ = Math.max(gBox.min.z, tBox.min.z + tSize.z * 0.35);
  gun.position.set(gBox.getCenter(new THREE.Vector3()).x, (gBox.min.y + gBox.max.y) / 2, pivotZ);
  turret.attach(gun);
  root.updateMatrixWorld(true);
  gun.attach(gunMesh);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'al_muzzle';
  gun.add(muzzle);
  muzzle.position.set(0, 0, gBox.max.z - pivotZ);

  const bodyBox = boxOf(bodyMesh);
  const size2 = all.getSize(new THREE.Vector3());
  const measure: ModelMeasure = {
    L: size2.z,
    W: size2.x,
    H: Math.max(bodyBox.max.y, tBox.min.y),
    tL: tSize.z,
    tW: tSize.x,
    tH: tSize.y,
    tZ: tCenter.z,
    barrel: gBox.max.z - pivotZ,
  };

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.frustumCulled = false; // skinned tracks: bounds don't follow the bones
    }
  });
  return { scene: root, clips, measure };
}

/** A fresh copy of a template (skinned meshes need SkeletonUtils, not Object3D.clone). */
export function cloneTemplate(cls: TankClass): { root: THREE.Object3D; clips: THREE.AnimationClip[] } | null {
  const t = templates[cls];
  if (!t) return null;
  return { root: SkeletonUtils.clone(t.scene), clips: t.clips };
}
