import * as THREE from 'three';

const MAX = 2500;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number;
  drag: number; gravity: number;
  additive: boolean;
}

function makeLayer(additive: boolean) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 4);
  const size = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 600 } },
    vertexShader: `
      attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
      void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      varying vec4 vColor;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
        if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor.rgb, vColor.a * a); }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, geo, mat, list: [] as P[] };
}

export class Fx {
  private add = makeLayer(true);
  private norm = makeLayer(false);
  private tracers: { mesh: THREE.Mesh; life: number }[] = [];
  private tracerGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 4);

  constructor(private scene: THREE.Scene) {
    scene.add(this.norm.points);
    scene.add(this.add.points);
    this.norm.points.renderOrder = 5;
    this.add.points.renderOrder = 6;
  }

  setScale(viewportHeight: number, fovDeg: number): void {
    const s = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.add.mat.uniforms.scale.value = s;
    this.norm.mat.uniforms.scale.value = s;
  }

  private spawn(p: Partial<P> & { x: number; y: number; z: number }): void {
    const layer = p.additive ? this.add : this.norm;
    if (layer.list.length >= MAX) layer.list.shift();
    layer.list.push({
      vx: 0, vy: 0, vz: 0, life: 1, max: 1, size: 1, grow: 0,
      r: 1, g: 1, b: 1, drag: 1, gravity: 0, additive: false,
      ...p,
    } as P);
  }

  explosion(at: THREE.Vector3, scale = 1): void {
    for (let i = 0; i < 26 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = (4 + Math.random() * 9) * scale;
      const k = Math.sqrt(1 - u * u);
      const life = 0.35 + Math.random() * 0.4;
      this.spawn({
        x: at.x, y: at.y, z: at.z,
        vx: Math.cos(a) * k * s, vy: Math.abs(u) * s * 0.8 + 2, vz: Math.sin(a) * k * s,
        life, max: life, size: (1.6 + Math.random() * 1.8) * scale, grow: 2.5 * scale,
        r: 1, g: 0.55 + Math.random() * 0.35, b: 0.15, drag: 3, additive: true,
      });
    }
    for (let i = 0; i < 14 * scale; i++) {
      const life = 1.2 + Math.random() * 1.4;
      this.spawn({
        x: at.x + (Math.random() - 0.5) * 2 * scale, y: at.y + Math.random(), z: at.z + (Math.random() - 0.5) * 2 * scale,
        vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 3,
        life, max: life, size: 2.2 * scale, grow: 2.2 * scale,
        r: 0.18, g: 0.18, b: 0.2, drag: 1.2,
      });
    }
    // sparks
    for (let i = 0; i < 16 * scale; i++) {
      const life = 0.4 + Math.random() * 0.5;
      this.spawn({
        x: at.x, y: at.y, z: at.z,
        vx: (Math.random() - 0.5) * 30, vy: Math.random() * 18, vz: (Math.random() - 0.5) * 30,
        life, max: life, size: 0.25, r: 1, g: 0.8, b: 0.4, drag: 1, gravity: 25, additive: true,
      });
    }
  }

  muzzle(at: THREE.Vector3, dir: THREE.Vector3): void {
    for (let i = 0; i < 10; i++) {
      const s = 6 + Math.random() * 14;
      const life = 0.1 + Math.random() * 0.12;
      this.spawn({
        x: at.x, y: at.y, z: at.z,
        vx: dir.x * s + (Math.random() - 0.5) * 3, vy: dir.y * s + (Math.random() - 0.5) * 3, vz: dir.z * s + (Math.random() - 0.5) * 3,
        life, max: life, size: 1.2 + Math.random(), grow: 3, r: 1, g: 0.75, b: 0.3, drag: 4, additive: true,
      });
    }
    for (let i = 0; i < 6; i++) {
      const life = 0.8 + Math.random() * 0.6;
      this.spawn({
        x: at.x, y: at.y, z: at.z,
        vx: dir.x * 3 + (Math.random() - 0.5) * 2, vy: 0.8 + Math.random(), vz: dir.z * 3 + (Math.random() - 0.5) * 2,
        life, max: life, size: 1.2, grow: 2.5, r: 0.55, g: 0.57, b: 0.6, drag: 1.5,
      });
    }
  }

  sparks(at: THREE.Vector3, color = new THREE.Color(1, 0.85, 0.4), n = 14): void {
    for (let i = 0; i < n; i++) {
      const life = 0.25 + Math.random() * 0.3;
      this.spawn({
        x: at.x, y: at.y, z: at.z,
        vx: (Math.random() - 0.5) * 22, vy: Math.random() * 12, vz: (Math.random() - 0.5) * 22,
        life, max: life, size: 0.3, r: color.r, g: color.g, b: color.b, drag: 2, gravity: 20, additive: true,
      });
    }
  }

  dust(at: THREE.Vector3): void {
    const life = 0.8 + Math.random() * 0.5;
    this.spawn({
      x: at.x + (Math.random() - 0.5), y: at.y + 0.2, z: at.z + (Math.random() - 0.5),
      vx: (Math.random() - 0.5), vy: 0.6 + Math.random() * 0.5, vz: (Math.random() - 0.5),
      life, max: life, size: 0.9, grow: 1.8, r: 0.32, g: 0.35, b: 0.42, drag: 1,
    });
  }

  smoke(at: THREE.Vector3): void {
    const life = 2 + Math.random();
    this.spawn({
      x: at.x + (Math.random() - 0.5), y: at.y, z: at.z + (Math.random() - 0.5),
      vx: (Math.random() - 0.5) * 0.6, vy: 2 + Math.random(), vz: (Math.random() - 0.5) * 0.6,
      life, max: life, size: 1.4, grow: 2, r: 0.1, g: 0.1, b: 0.12, drag: 0.5,
    });
    if (Math.random() < 0.3) {
      const l2 = 0.4;
      this.spawn({ x: at.x, y: at.y, z: at.z, vy: 2, life: l2, max: l2, size: 1, grow: 1, r: 1, g: 0.45, b: 0.1, additive: true });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(this.tracerGeo, mat);
    m.scale.set(1, len, 1);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.scene.add(m);
    this.tracers.push({ mesh: m, life: 0.12 });
  }

  update(dt: number): void {
    for (const layer of [this.add, this.norm]) {
      const pos = layer.geo.attributes.position as THREE.BufferAttribute;
      const col = layer.geo.attributes.color as THREE.BufferAttribute;
      const size = layer.geo.attributes.size as THREE.BufferAttribute;
      let w = 0;
      for (let i = 0; i < layer.list.length; i++) {
        const p = layer.list[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy = p.vy * k - p.gravity * dt;
        p.vz *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.size += p.grow * dt;
        layer.list[w++] = p;
      }
      layer.list.length = w;
      for (let i = 0; i < w; i++) {
        const p = layer.list[i];
        const t = p.life / p.max;
        pos.setXYZ(i, p.x, p.y, p.z);
        col.setXYZW(i, p.r, p.g, p.b, p.additive ? t : Math.min(1, t * 1.5) * 0.75);
        size.setX(i, p.size);
      }
      layer.geo.setDrawRange(0, w);
      pos.needsUpdate = true;
      col.needsUpdate = true;
      size.needsUpdate = true;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.12);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.add.points, this.norm.points);
    this.add.geo.dispose();
    this.norm.geo.dispose();
    for (const t of this.tracers) this.scene.remove(t.mesh);
  }
}
