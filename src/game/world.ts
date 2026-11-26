import * as THREE from 'three';

/** Half the arena's side length; changes with the game mode (see generateMap). */
export let ARENA_HALF = 100;

export type TeamSize = 4 | 8 | 12;

export interface MapInfo {
  teamSize: TeamSize;
  half: number;
  seed: number;
  theme: MapTheme;
}

export interface MapTheme {
  name: string;
  ground: string;
  grid: string;
  neon: number;
  neon2: number;
  fog: number;
  sky: number;
}

const THEMES: MapTheme[] = [
  { name: 'Neon Şehir', ground: '#26324e', grid: 'rgba(60,140,255,', neon: 0x33aaff, neon2: 0xff3d7f, fog: 0x0a1024, sky: 0x070b18 },
  { name: 'Çöl Üssü', ground: '#4a3a2a', grid: 'rgba(255,170,60,', neon: 0xffa23a, neon2: 0x33d6ff, fog: 0x1c120a, sky: 0x120b07 },
  { name: 'Zehirli Bölge', ground: '#243a2c', grid: 'rgba(90,255,140,', neon: 0x5dff8a, neon2: 0xd24bff, fog: 0x08160d, sky: 0x050d08 },
  { name: 'Buz Limanı', ground: '#2c3e4e', grid: 'rgba(180,230,255,', neon: 0xbfeaff, neon2: 0x3a8bff, fog: 0x0d1820, sky: 0x08101a },
];

/** Arena half-size per team size: bigger battles get bigger maps. */
export const MODE_HALF: Record<TeamSize, number> = { 4: 85, 8: 120, 12: 150 };

interface Hill {
  x: number;
  z: number;
  r: number;
  h: number;
}

const HILLS: Hill[] = [];
export let MAP: MapInfo = { teamSize: 4, half: 100, seed: 1, theme: THEMES[0] };

export function heightAt(x: number, z: number): number {
  let y = 0;
  for (const h of HILLS) {
    const dx = x - h.x;
    const dz = z - h.z;
    y += h.h * Math.exp(-(dx * dx + dz * dz) / (h.r * h.r));
  }
  y += 0.35 * Math.sin(x * 0.11) * Math.cos(z * 0.09);
  return y;
}

export function normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-dx, 2 * e, -dz).normalize();
}

export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  kind: 'block' | 'wall' | 'low';
}

interface Def {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind?: Obstacle['kind'];
}

function makeObstacle(d: Def): Obstacle {
  const minX = d.x - d.w / 2;
  const maxX = d.x + d.w / 2;
  const minZ = d.z - d.d / 2;
  const maxZ = d.z + d.d / 2;
  let lo = Infinity;
  for (const [x, z] of [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
    [d.x, d.z],
  ]) {
    lo = Math.min(lo, heightAt(x, z));
  }
  return { minX, maxX, minZ, maxZ, minY: lo - 2, maxY: lo + d.h, kind: d.kind ?? 'block' };
}

export const OBSTACLES: Obstacle[] = [];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from the back wall kept free for spawning. */
export const SPAWN_DEPTH = 24;

/**
 * Builds a new random, point-symmetric map for the team size (both sides get the same terrain).
 * Bigger modes get a bigger arena with proportionally more hills and cover.
 */
export function generateMap(teamSize: TeamSize, seed = Math.floor(Math.random() * 1e9)): MapInfo {
  const r = rng(seed);
  const half = MODE_HALF[teamSize];
  ARENA_HALF = half;
  const area = (half / 100) ** 2;
  const theme = THEMES[Math.floor(r() * THEMES.length)];

  HILLS.length = 0;
  HILLS.push({ x: 0, z: 0, r: 14 + r() * 8, h: 2 + r() * 3 });
  const hillPairs = Math.round(4 * area + r() * 2);
  for (let i = 0; i < hillPairs; i++) {
    const h: Hill = {
      x: (r() * 2 - 1) * (half - 20),
      z: (r() * 2 - 1) * (half - SPAWN_DEPTH - 10),
      r: 10 + r() * 14,
      h: 1.5 + r() * 5,
    };
    HILLS.push(h, { ...h, x: -h.x, z: -h.z });
  }

  OBSTACLES.length = 0;
  const placed: Def[] = [];
  const pairs = Math.round(13 * area);
  let tries = 0;
  while (placed.length < pairs && tries++ < pairs * 40) {
    const kindRoll = r();
    const kind: Obstacle['kind'] = kindRoll < 0.45 ? 'block' : kindRoll < 0.7 ? 'wall' : 'low';
    let w: number;
    let d: number;
    let h: number;
    if (kind === 'block') {
      w = 6 + r() * 10;
      d = 6 + r() * 10;
      h = 5 + r() * 7;
    } else if (kind === 'wall') {
      w = 2.5 + r();
      d = 10 + r() * 14;
      h = 3 + r() * 1.5;
    } else {
      w = 8 + r() * 8;
      d = 3;
      h = 2.4 + r() * 0.6;
    }
    if (r() < 0.5) [w, d] = [d, w];
    const x = (r() * 2 - 1) * (half - 12 - w / 2);
    const z = -(r() * (half - SPAWN_DEPTH - d / 2));
    // keep the very center and spawn rows open, and leave lanes between obstacles
    if (Math.abs(x) < 8 && Math.abs(z) < 8) continue;
    const clash = placed.some(
      (o) => Math.abs(o.x - x) < (o.w + w) / 2 + 9 && Math.abs(o.z - z) < (o.d + d) / 2 + 9,
    );
    const clashMirror = Math.abs(x) < w / 2 + 9 && Math.abs(z) < d / 2 + 9; // too close to its own mirror
    if (clash || clashMirror) continue;
    placed.push({ x, z, w, d, h, kind });
  }
  for (const d of placed) OBSTACLES.push(makeObstacle(d), makeObstacle({ ...d, x: -d.x, z: -d.z }));

  MAP = { teamSize, half, seed, theme };
  return MAP;
}

generateMap(4, 1);

export interface RayHit {
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const _n = new THREE.Vector3();

/** Ray vs axis-aligned box (slab test). Returns entry distance and face normal. */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  maxT: number,
  normalOut?: THREE.Vector3,
): number {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [minX, minY, minZ];
  const mx = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (mn[i] - o[i]) * inv;
    let t2 = (mx[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (axis < 0) return -1; // ray starts inside
  if (normalOut) {
    normalOut.set(0, 0, 0);
    normalOut.setComponent(axis, sign);
  }
  return tmin;
}

/** Nearest static hit (obstacles, terrain, boundary walls) along a segment. */
export function raycastStatic(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): RayHit | null {
  let best: RayHit | null = null;
  for (const o of OBSTACLES) {
    const t = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ, maxT, _n);
    if (t >= 0 && (!best || t < best.t)) {
      best = { t, point: origin.clone().addScaledVector(dir, t), normal: _n.clone() };
    }
  }
  const limit = best ? best.t : maxT;
  // Terrain: march, then refine.
  const step = 1.0;
  let prevT = 0;
  for (let t = step; t <= limit + step; t += step) {
    const tt = Math.min(t, limit);
    const x = origin.x + dir.x * tt;
    const y = origin.y + dir.y * tt;
    const z = origin.z + dir.z * tt;
    if (y < heightAt(x, z)) {
      let a = prevT;
      let b = tt;
      for (let i = 0; i < 8; i++) {
        const m = (a + b) / 2;
        const p = origin.clone().addScaledVector(dir, m);
        if (p.y < heightAt(p.x, p.z)) b = m;
        else a = m;
      }
      const p = origin.clone().addScaledVector(dir, b);
      return { t: b, point: p, normal: normalAt(p.x, p.z) };
    }
    prevT = tt;
    if (tt >= limit) break;
  }
  if (best) return best;
  // Boundary walls.
  const end = origin.clone().addScaledVector(dir, maxT);
  if (Math.abs(end.x) > ARENA_HALF || Math.abs(end.z) > ARENA_HALF) {
    const tx = dir.x !== 0 ? ((Math.sign(dir.x) * ARENA_HALF - origin.x) / dir.x) : Infinity;
    const tz = dir.z !== 0 ? ((Math.sign(dir.z) * ARENA_HALF - origin.z) / dir.z) : Infinity;
    const t = Math.max(0, Math.min(tx, tz));
    const normal = tx < tz ? new THREE.Vector3(-Math.sign(dir.x), 0, 0) : new THREE.Vector3(0, 0, -Math.sign(dir.z));
    return { t, point: origin.clone().addScaledVector(dir, t), normal };
  }
  return null;
}

const _d = new THREE.Vector3();
export function lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 0.01) return true;
  _d.divideScalar(len);
  const hit = raycastStatic(a, _d, len - 0.5);
  return !hit;
}

/** Push a circle (x,z,r) out of obstacles and keep it inside the arena. */
export function resolveCircle(p: THREE.Vector3, r: number): boolean {
  let hit = false;
  for (const o of OBSTACLES) {
    if (p.y > o.maxY + 0.5) continue;
    const cx = Math.max(o.minX, Math.min(p.x, o.maxX));
    const cz = Math.max(o.minZ, Math.min(p.z, o.maxZ));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // Center inside the box: push out along the shallowest axis.
        const pushes = [p.x - o.minX + r, o.maxX - p.x + r, p.z - o.minZ + r, o.maxZ - p.z + r];
        const i = pushes.indexOf(Math.min(...pushes));
        if (i === 0) p.x = o.minX - r;
        else if (i === 1) p.x = o.maxX + r;
        else if (i === 2) p.z = o.minZ - r;
        else p.z = o.maxZ + r;
      }
    }
  }
  const lim = ARENA_HALF - r;
  if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) hit = true;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return hit;
}

/** True if a point is blocked for driving (inside an inflated obstacle or outside the arena). */
export function blockedAt(x: number, z: number, r: number): boolean {
  if (Math.abs(x) > ARENA_HALF - r || Math.abs(z) > ARENA_HALF - r) return true;
  for (const o of OBSTACLES) {
    if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- visuals

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26324e';
  g.fillRect(0, 0, 256, 256);
  // subtle noise
  for (let i = 0; i < 1400; i++) {
    const v = 20 + Math.random() * 18;
    g.fillStyle = `rgba(${v},${v + 8},${v + 22},0.5)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = MAP.theme.grid + '0.35)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.strokeStyle = MAP.theme.grid + '0.12)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 256);
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(Math.round(ARENA_HALF / 4), Math.round(ARENA_HALF / 4));
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function windowTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1220';
  g.fillRect(0, 0, 64, 128);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 4; y < 128; y += 8) {
    for (let x = 4; x < 64; x += 8) {
      if (rnd() < 0.45) {
        const warm = rnd() < 0.5;
        g.fillStyle = warm ? 'rgba(255,190,90,0.9)' : 'rgba(80,200,255,0.9)';
        g.fillRect(x, y, 4, 4);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(scene: THREE.Scene): void {
  scene.background = new THREE.Color(MAP.theme.sky);
  scene.fog = new THREE.Fog(MAP.theme.fog, ARENA_HALF * 0.9, ARENA_HALF * 2.6);

  const hemi = new THREE.HemisphereLight(0xa8c4ff, 0x3a3040, 2.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xdfe9ff, 2.6);
  sun.position.set(-60, 120, -40);
  scene.add(sun);

  // Terrain
  const size = ARENA_HALF * 2 + 60;
  const geo = new THREE.PlaneGeometry(size, size, Math.round(size / 2.4), Math.round(size / 2.4));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.9, metalness: 0 }),
  );
  scene.add(ground);

  // Obstacles
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x3a4560, roughness: 0.75, metalness: 0.1 });
  const lowMat = new THREE.MeshStandardMaterial({ color: 0x76604a, roughness: 0.85, metalness: 0.05 });
  const neon = new THREE.MeshBasicMaterial({ color: MAP.theme.neon });
  const neonPink = new THREE.MeshBasicMaterial({ color: MAP.theme.neon2 });
  OBSTACLES.forEach((o, i) => {
    const w = o.maxX - o.minX;
    const d = o.maxZ - o.minZ;
    const h = o.maxY - o.minY;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.kind === 'low' ? lowMat : blockMat);
    m.position.set((o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2, (o.minZ + o.maxZ) / 2);
    scene.add(m);
    // Neon trim on top edge
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.18, d + 0.1), i % 3 === 0 ? neonPink : neon);
    trim.position.set(m.position.x, o.maxY - 0.15, m.position.z);
    scene.add(trim);
  });

  // Boundary walls with neon strip
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3552, roughness: 0.6, metalness: 0.1 });
  const stripMat = new THREE.MeshBasicMaterial({ color: MAP.theme.neon });
  for (let i = 0; i < 4; i++) {
    const horiz = i < 2;
    const s = i % 2 === 0 ? -1 : 1;
    const len = ARENA_HALF * 2 + 4;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 2, 7, horiz ? 2 : len), wallMat);
    wall.position.set(horiz ? 0 : s * (ARENA_HALF + 1), 2.5, horiz ? s * (ARENA_HALF + 1) : 0);
    scene.add(wall);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 2.2, 0.5, horiz ? 2.2 : len), stripMat);
    strip.position.set(wall.position.x, 5.2, wall.position.z);
    scene.add(strip);
  }

  // City skyline outside the arena
  const towerGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 70; i++) {
    const ang = (i / 70) * Math.PI * 2 + Math.random() * 0.05;
    const dist = ARENA_HALF * 1.5 + Math.random() * 70;
    const w = 10 + Math.random() * 16;
    const h = 25 + Math.random() * 80;
    const tex = windowTexture(i * 977 + 13);
    tex.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 16)));
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x9fb6ff });
    const t = new THREE.Mesh(towerGeo, mat);
    t.scale.set(w, h, w);
    t.position.set(Math.cos(ang) * dist, h / 2 - 4, Math.sin(ang) * dist);
    scene.add(t);
  }
}

// ---------------------------------------------------------------- oriented boxes (2D, top-down)

/** A rectangle on the ground: center, half extents (hx across, hz along), and yaw. */
export interface Rect {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
}

export interface Push {
  /** Unit direction to move `a` out of `b` (pointing away from b). */
  nx: number;
  nz: number;
  depth: number;
}

function axesOf(r: Rect): [number, number][] {
  const s = Math.sin(r.yaw);
  const c = Math.cos(r.yaw);
  // forward (sin, cos), right (cos, -sin)
  return [
    [s, c],
    [c, -s],
  ];
}

function radiusOn(r: Rect, ax: number, az: number): number {
  const s = Math.sin(r.yaw);
  const c = Math.cos(r.yaw);
  return r.hz * Math.abs(s * ax + c * az) + r.hx * Math.abs(c * ax - s * az);
}

/** Separating-axis test between two rectangles. Returns how to push `a` out of `b`. */
export function rectOverlap(a: Rect, b: Rect): Push | null {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  let best: Push | null = null;
  for (const [ax, az] of [...axesOf(a), ...axesOf(b)]) {
    const d = dx * ax + dz * az;
    const overlap = radiusOn(a, ax, az) + radiusOn(b, ax, az) - Math.abs(d);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const sign = d > 0 ? -1 : 1;
      best = { nx: ax * sign, nz: az * sign, depth: overlap };
    }
  }
  return best;
}

/**
 * Pushes a tank rectangle out of obstacles and the arena walls (mutates r.cx/r.cz).
 * Returns the total push vector, or null if nothing was hit.
 */
export function resolveRect(r: Rect, y: number): { x: number; z: number } | null {
  let px = 0;
  let pz = 0;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const o of OBSTACLES) {
      if (y > o.maxY + 0.5) continue;
      const box: Rect = {
        cx: (o.minX + o.maxX) / 2,
        cz: (o.minZ + o.maxZ) / 2,
        hx: (o.maxX - o.minX) / 2,
        hz: (o.maxZ - o.minZ) / 2,
        yaw: 0,
      };
      const p = rectOverlap(r, box);
      if (p) {
        r.cx += p.nx * p.depth;
        r.cz += p.nz * p.depth;
        px += p.nx * p.depth;
        pz += p.nz * p.depth;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Arena walls: keep every corner inside.
  const ex = radiusOn(r, 1, 0);
  const ez = radiusOn(r, 0, 1);
  const lim = ARENA_HALF;
  if (r.cx + ex > lim) { px -= r.cx + ex - lim; r.cx = lim - ex; }
  if (r.cx - ex < -lim) { px += -lim - (r.cx - ex); r.cx = -lim + ex; }
  if (r.cz + ez > lim) { pz -= r.cz + ez - lim; r.cz = lim - ez; }
  if (r.cz - ez < -lim) { pz += -lim - (r.cz - ez); r.cz = -lim + ez; }
  return px !== 0 || pz !== 0 ? { x: px, z: pz } : null;
}
