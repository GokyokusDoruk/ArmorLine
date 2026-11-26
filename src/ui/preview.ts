import * as THREE from 'three';
import type { Rarity } from '../data/rarity';
import type { Nation, TankClass } from '../data/tanks';
import { buildTankModel, updateDivineTrim, type TankModel } from '../game/tankModel';

/** Rotating 3D tank on a neon pad, drawn behind the garage UI. */
export class GaragePreview {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private model: TankModel | null = null;
  private key = '';
  private t = 0;
  private ring: THREE.Mesh;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color(0x070b18);
    this.scene.fog = new THREE.Fog(0x070b18, 25, 60);
    this.scene.add(new THREE.HemisphereLight(0x9fc0ff, 0x221a2a, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(6, 10, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x33aaff, 2.5);
    rim.position.set(-8, 4, -8);
    this.scene.add(rim);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6.4, 0.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x141c30, metalness: 0.6, roughness: 0.4 }),
    );
    pad.position.y = -0.25;
    this.scene.add(pad);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: 0x33aaff }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.02;
    this.scene.add(this.ring);
    const grid = new THREE.GridHelper(80, 40, 0x1d3a6a, 0x13213d);
    grid.position.y = -0.5;
    this.scene.add(grid);
  }

  show(nation: Nation, cls: TankClass, rarity: Rarity, ringColor: string): void {
    const k = `${nation}-${cls}-${rarity}`;
    (this.ring.material as THREE.MeshBasicMaterial).color.set(ringColor === 'rainbow' ? '#ffffff' : ringColor);
    if (k === this.key) return;
    this.key = k;
    if (this.model) this.scene.remove(this.model.root);
    this.model = buildTankModel(nation, cls, rarity);
    this.scene.add(this.model.root);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    const portrait = h > w;
    this.camera.fov = portrait ? 55 : 38;
    this.camera.updateProjectionMatrix();
  }

  frame(dt: number): void {
    this.t += dt;
    if (this.model) {
      this.model.root.rotation.y = this.t * 0.35;
      this.model.turret.rotation.y = Math.sin(this.t * 0.6) * 0.4;
      updateDivineTrim(this.model, this.t);
    }
    const portrait = window.innerHeight > window.innerWidth;
    if (portrait) {
      this.camera.position.set(0, 9, 25);
      this.camera.lookAt(0, 0.4, 0);
    } else {
      // UI sits on the right in landscape, so shift the tank left.
      this.camera.position.set(5, 7, 21);
      this.camera.lookAt(5, 0.8, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
