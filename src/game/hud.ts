import * as THREE from 'three';
import { RARITY_INFO, rarityCss } from '../data/rarity';
import { NATION_INFO } from '../data/tanks';
import type { Tank } from './tank';
import { ARENA_HALF, OBSTACLES } from './world';
import { chanceColor } from './armor';

export interface HudFrame {
  timeLeft: number;
  player: Tank;
  tanks: Tank[];
  visible: (t: Tank) => boolean;
  camera: THREE.Camera;
  status: string;
  statusColor: string;
  lock: Tank | null;
  /** Optic analysis for the current aim point; null when not available. */
  analysis: { chance: number; damage: number } | null;
  opticTier: number;
  zoomed: boolean;
  arty: boolean;
  spectating: Tank | null;
}

interface Tag {
  el: HTMLDivElement;
  hp: HTMLDivElement;
}

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  life: number;
  max: number;
}

const _v = new THREE.Vector3();

export class Hud {
  readonly root: HTMLDivElement;
  readonly fireBtn: HTMLDivElement;
  readonly zoomBtn: HTMLDivElement;
  readonly artyBtn: HTMLDivElement;
  readonly menuBtn: HTMLDivElement;
  private timer: HTMLDivElement;
  private teamA: HTMLDivElement;
  private teamB: HTMLDivElement;
  private dmg: HTMLDivElement;
  private hpBar: HTMLDivElement;
  private hpText: HTMLDivElement;
  private ammo: HTMLDivElement;
  private status: HTMLDivElement;
  private reloadBar: HTMLDivElement;
  private reticle: HTMLDivElement;
  private reticleText: HTMLDivElement;
  private callouts: HTMLDivElement;
  private feed: HTMLDivElement;
  private minimap: HTMLCanvasElement;
  private vignette: HTMLDivElement;
  readonly deadPanel: HTMLDivElement;
  private tags = new Map<number, Tag>();
  private floaters: Floater[] = [];
  private mmTimer = 0;

  constructor(parent: HTMLElement) {
    const r = document.createElement('div');
    r.className = 'hud';
    r.innerHTML = `
      <div class="hud-top">
        <div class="team team-a"></div>
        <div class="timer">5:00</div>
        <div class="team team-b"></div>
      </div>
      <canvas class="minimap" width="240" height="240"></canvas>
      <div class="hud-dmg">Hasar 0</div>
      <div class="feed"></div>
      <div class="tags"></div>
      <div class="floaters"></div>
      <div class="reticle"><div class="ret-ring"></div><div class="ret-dot"></div><div class="ret-text"></div></div>
      <div class="callouts"></div>
      <div class="player-panel">
        <div class="status"></div>
        <div class="reload"><div></div></div>
        <div class="hp"><div class="hp-fill"></div><div class="hp-text"></div></div>
        <div class="ammo"></div>
      </div>
      <div class="btn fire-btn">ATEŞ</div>
      <div class="btn zoom-btn">🔭</div>
      <div class="btn arty-btn">🎯</div>
      <div class="btn menu-btn">☰</div>
      <div class="vignette"></div>
      <div class="dead-panel hidden"></div>
    `;
    parent.appendChild(r);
    this.root = r;
    const q = <T extends HTMLElement>(s: string) => r.querySelector(s) as T;
    this.timer = q('.timer');
    this.teamA = q('.team-a');
    this.teamB = q('.team-b');
    this.dmg = q('.hud-dmg');
    this.hpBar = q('.hp-fill');
    this.hpText = q('.hp-text');
    this.ammo = q('.ammo');
    this.status = q('.status');
    this.reloadBar = q('.reload > div');
    this.reticle = q('.reticle');
    this.reticleText = q('.ret-text');
    this.callouts = q('.callouts');
    this.feed = q('.feed');
    this.minimap = q('.minimap');
    this.fireBtn = q('.fire-btn');
    this.zoomBtn = q('.zoom-btn');
    this.artyBtn = q('.arty-btn');
    this.menuBtn = q('.menu-btn');
    this.vignette = q('.vignette');
    this.deadPanel = q('.dead-panel');
  }

  setupTeams(tanks: Tank[], player: Tank): void {
    const pip = (t: Tank) =>
      `<span class="pip ${t === player ? 'me' : ''}" data-id="${t.id}" title="${t.spec.name}">${clsGlyph(t)}</span>`;
    this.teamA.innerHTML = tanks.filter((t) => t.spec.team === 0).map(pip).join('');
    this.teamB.innerHTML = tanks.filter((t) => t.spec.team === 1).map(pip).join('');
    this.artyBtn.style.display = player.spec.cls === 'artillery' ? 'flex' : 'none';
  }

  update(f: HudFrame, dt: number, w: number, h: number): void {
    const m = Math.max(0, Math.ceil(f.timeLeft));
    this.timer.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('low', m <= 30);
    for (const t of f.tanks) {
      const el = this.root.querySelector(`.pip[data-id="${t.id}"]`);
      el?.classList.toggle('dead', !t.alive);
    }
    const p = f.player;
    this.dmg.textContent = `Hasar ${Math.round(p.damageDealt)}`;
    const hpPct = p.hp / p.stats.hp;
    this.hpBar.style.width = `${hpPct * 100}%`;
    this.hpBar.style.background = hpPct > 0.5 ? '#33d6ff' : hpPct > 0.25 ? '#ffc531' : '#ff3b3b';
    this.hpText.textContent = `${Math.ceil(p.hp)}`;
    let ammoHtml = '';
    for (let i = 0; i < p.stats.magazine; i++) ammoHtml += `<span class="shell ${i < p.ammo ? '' : 'empty'}"></span>`;
    this.ammo.innerHTML = ammoHtml;
    this.status.textContent = f.status;
    this.status.style.color = f.statusColor;
    const reloadTotal = p.ammo > 0 ? p.stats.clipInterval : p.stats.reload;
    this.reloadBar.style.width = p.reloadLeft > 0 && reloadTotal > 0 ? `${(1 - p.reloadLeft / reloadTotal) * 100}%` : '100%';
    this.reloadBar.parentElement!.classList.toggle('ready', p.reloadLeft <= 0);
    this.vignette.style.opacity = String(Math.max(0, 0.6 - hpPct) * 1.2);

    // Reticle
    this.reticle.style.display = f.spectating || f.arty ? 'none' : 'block';
    const disp = p.currentDispersion();
    const ringPx = Math.max(16, Math.min(140, disp * 1600 * (f.zoomed ? p.stats.zoom : 1)));
    const ring = this.reticle.firstElementChild as HTMLDivElement;
    ring.style.width = ring.style.height = `${ringPx}px`;
    let col = f.lock ? '#ffffff' : 'rgba(255,255,255,0.7)';
    let txt = '';
    if (f.lock && f.analysis && f.opticTier > 0) {
      col = chanceColor(f.analysis.chance);
      if (f.opticTier >= 2) txt += `${Math.round(f.analysis.chance * 100)}%`;
      if (f.opticTier >= 3) txt += ` · ~${f.analysis.damage}`;
    } else if (f.lock) {
      txt = `${Math.round(p.aim * 100)}%`;
    }
    ring.style.borderColor = col;
    ring.style.boxShadow = f.lock ? `0 0 12px ${col}` : 'none';
    this.reticleText.textContent = txt;
    this.reticleText.style.color = col;
    this.zoomBtn.classList.toggle('on', f.zoomed);
    this.artyBtn.classList.toggle('on', f.arty);

    // Name tags
    const seen = new Set<number>();
    for (const t of f.tanks) {
      if (t === p || !t.alive) continue;
      const enemy = t.spec.team !== p.spec.team;
      if (enemy && !f.visible(t)) continue;
      t.center(_v);
      _v.y += t.dims.H + t.dims.tH + 0.8;
      _v.project(f.camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) continue;
      seen.add(t.id);
      let tag = this.tags.get(t.id);
      if (!tag) {
        const el = document.createElement('div');
        el.className = `tag ${enemy ? 'enemy' : 'ally'}`;
        const r = t.spec.rarity;
        el.innerHTML = `<div class="tag-name"><span class="rar" style="background:${rarityCss(r)}"></span>${NATION_INFO[t.spec.nation].flag} ${t.modelName}<small>${t.spec.name}</small></div><div class="tag-hp"><div></div></div>`;
        this.root.querySelector('.tags')!.appendChild(el);
        tag = { el, hp: el.querySelector('.tag-hp > div') as HTMLDivElement };
        this.tags.set(t.id, tag);
      }
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      tag.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      tag.el.style.display = 'block';
      tag.el.classList.toggle('locked', t === f.lock);
      tag.hp.style.width = `${(t.hp / t.stats.hp) * 100}%`;
    }
    for (const [id, tag] of this.tags) if (!seen.has(id)) tag.el.style.display = 'none';

    // Floating numbers
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const fl = this.floaters[i];
      fl.life -= dt;
      if (fl.life <= 0) {
        fl.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      _v.copy(fl.pos);
      _v.y += (1 - fl.life / fl.max) * 3;
      _v.project(f.camera);
      if (_v.z > 1) {
        fl.el.style.display = 'none';
        continue;
      }
      fl.el.style.display = 'block';
      fl.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`;
      fl.el.style.opacity = String(Math.min(1, fl.life / 0.4));
    }

    this.mmTimer -= dt;
    if (this.mmTimer <= 0) {
      this.mmTimer = 0.1;
      this.drawMinimap(f);
    }
  }

  private drawMinimap(f: HudFrame): void {
    const c = this.minimap.getContext('2d')!;
    const S = this.minimap.width;
    const k = S / (ARENA_HALF * 2);
    // team 0 sees its base at the bottom
    const flip = f.player.spec.team === 0 ? -1 : 1;
    const X = (x: number) => (x * flip + ARENA_HALF) * k;
    const Z = (z: number) => (z * flip + ARENA_HALF) * k;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(8,14,30,0.75)';
    c.fillRect(0, 0, S, S);
    c.fillStyle = 'rgba(90,120,170,0.55)';
    for (const o of OBSTACLES) {
      const x0 = X(o.minX), x1 = X(o.maxX), z0 = Z(o.minZ), z1 = Z(o.maxZ);
      c.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
    }
    const p = f.player;
    const me = f.spectating ?? p;
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.beginPath();
    c.arc(X(me.pos.x), Z(me.pos.z), me.stats.view * k, 0, Math.PI * 2);
    c.stroke();
    for (const t of f.tanks) {
      const enemy = t.spec.team !== p.spec.team;
      if (enemy && t.alive && !f.visible(t)) continue;
      const x = X(t.pos.x);
      const z = Z(t.pos.z);
      if (!t.alive) {
        c.fillStyle = 'rgba(150,150,150,0.6)';
        c.fillRect(x - 3, z - 3, 6, 6);
        continue;
      }
      c.fillStyle = t === p ? '#ffffff' : enemy ? '#ff4a4a' : '#45e07a';
      c.save();
      c.translate(x, z);
      // arrow pointing along hull yaw (mapped to minimap space)
      const fx = Math.sin(t.yaw) * flip;
      const fz = Math.cos(t.yaw) * flip;
      c.rotate(Math.atan2(fz, fx) + Math.PI / 2);
      c.beginPath();
      const s = t === p ? 9 : 7;
      c.moveTo(0, -s);
      c.lineTo(s * 0.7, s * 0.7);
      c.lineTo(-s * 0.7, s * 0.7);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.strokeStyle = 'rgba(80,160,255,0.8)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, S - 2, S - 2);
  }

  floatText(pos: THREE.Vector3, text: string, color: string, big = false): void {
    const el = document.createElement('div');
    el.className = `floater ${big ? 'big' : ''}`;
    el.textContent = text;
    el.style.color = color;
    this.root.querySelector('.floaters')!.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), life: 1.1, max: 1.1 });
  }

  callout(text: string, color: string): void {
    const el = document.createElement('div');
    el.className = 'callout';
    el.textContent = text;
    el.style.color = color;
    this.callouts.innerHTML = '';
    this.callouts.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  killFeed(killer: Tank | null, victim: Tank, playerTeam: number): void {
    const el = document.createElement('div');
    const kc = killer ? (killer.spec.team === playerTeam ? 'ally' : 'enemy') : '';
    const vc = victim.spec.team === playerTeam ? 'ally' : 'enemy';
    el.innerHTML = `<span class="${kc}">${killer ? killer.spec.name : '?'}</span> 💥 <span class="${vc}">${victim.spec.name}</span>`;
    this.feed.prepend(el);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    setTimeout(() => el.remove(), 5000);
  }

  flashHit(): void {
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('flash');
  }

  dispose(): void {
    this.root.remove();
  }
}

function clsGlyph(t: Tank): string {
  return { heavy: '▮', mobile: '➤', sniper: '✛', artillery: '◎' }[t.spec.cls];
}

export function rarityColorHex(t: Tank): string {
  const c = RARITY_INFO[t.spec.rarity].color;
  return c === 'rainbow' ? '#ffffff' : c;
}
