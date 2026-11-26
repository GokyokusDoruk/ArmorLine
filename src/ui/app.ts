import * as THREE from 'three';
import { RARITIES, RARITY_INFO, rarityChances, rarityCss, rarityIndex, type Rarity } from '../data/rarity';
import { CLASSES, CLASS_INFO, MAX_LEVEL, NATIONS, NATION_INFO, TANK_NAMES, WEAPONS, WEAPON_INFO, type Nation, type TankClass, type TankStats, type WeaponId } from '../data/tanks';
import { OPTIC_ERROR, SLOTS, SLOT_INFO, partEffects, partName, type Part, type Slot } from '../data/parts';
import {
  equipPart, grantStarterTanks, loadProfile, partOwner, resetProfile, saveProfile, selectedTank,
  sellPart, sellValue, tankLevel, tankStats, tankWeapon, unequipSlot, upgradeTank, upgradeTotal, type OwnedTank, type Profile,
} from '../meta/profile';
import { applyReward, rollRewards, COINS_PER_ASSIST, COINS_PER_DAMAGE, COINS_PER_KILL, DROP_CHANCE, type BattleReward } from '../meta/rewards';
import { buyOffer, msUntilRefresh, shopOffers } from '../meta/shop';
import { Battle, type BattleResult } from '../game/battle';
import { scoreboardHtml } from '../game/scoreboard';
import type { TeamSize } from '../game/world';
import { isMuted, setMuted, sfx, unlockAudio } from '../game/audio';
import { GaragePreview } from './preview';
import { loadTankModels } from '../game/models';
import { applyModelDims } from '../game/tankModel';

type Screen = 'nation' | 'garage' | 'battle';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function rarityBadge(r: Rarity): string {
  return `<span class="rbadge r-${r}" style="--rc:${rarityCss(r)}">${RARITY_INFO[r].name}</span>`;
}

/** Tank photos, bundled by Vite with content-hashed file names (safe to cache forever). */
const TANK_IMAGES = import.meta.glob<string>('../assets/tanks/*.jpg', { eager: true, query: '?url', import: 'default' });

function tankImg(n: Nation, c: TankClass): string {
  return TANK_IMAGES[`../assets/tanks/${n}-${c}.jpg`] ?? '';
}

const WEAPON_ICON: Record<WeaponId, string> = { heavy: '🔨', standard: '🎯', rapid: '⚡', clip: '🔁' };
const WEAPON_SHORT: Record<WeaponId, string> = { heavy: 'Ağır', standard: 'Standart', rapid: 'Hızlı', clip: 'Şarjör' };

function coins(n: number): string {
  return `<span class="coin">◈</span> ${Math.floor(n).toLocaleString('tr-TR')}`;
}

export class App {
  private profile: Profile;
  private screen: Screen = 'garage';
  private battle: Battle | null = null;
  private preview: GaragePreview;
  private clock = new THREE.Clock();
  private modal: HTMLDivElement | null = null;
  private shopTimer = 0;
  private quality: 'high' | 'low';
  private tankFilter: Nation | 'all' = 'all';
  private teamSize: TeamSize = (Number(localStorage.getItem('armorline.mode')) as TeamSize) || 4;

  constructor(private renderer: THREE.WebGLRenderer, private ui: HTMLElement) {
    this.profile = loadProfile();
    this.preview = new GaragePreview(renderer);
    const saved = localStorage.getItem('armorline.quality') as 'high' | 'low' | null;
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.quality = saved ?? (coarse ? 'low' : 'high');
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointerdown', () => unlockAudio(), { capture: true });
    this.resize();
    this.ui.innerHTML = '<div class="screen loading"><div class="logo">ARMOR<span>LINE</span></div><p class="sub">Tanklar yükleniyor…</p></div>';
    void loadTankModels().then(() => {
      applyModelDims();
      this.preview.reset();
      if (this.profile.tanks.length === 0) this.showNation();
      else this.showGarage();
    });
    renderer.setAnimationLoop(() => this.loop());
    if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = this;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.preview.resize();
    this.battle?.resize();
  }

  private loop(): void {
    const dt = this.clock.getDelta();
    if (this.screen === 'battle' && this.battle) {
      this.battle.frame(dt);
    } else {
      this.preview.frame(dt);
      this.shopTimer -= dt;
      if (this.shopTimer <= 0) {
        this.shopTimer = 1;
        const el = document.querySelector('.shop-timer');
        if (el) {
          const ms = msUntilRefresh();
          const s = Math.ceil(ms / 1000);
          el.textContent = `Yenilenme: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          if (s >= 299 && this.modal?.dataset.kind === 'shop') this.openShop();
        }
      }
    }
  }

  private save(): void {
    saveProfile(this.profile);
  }

  // ------------------------------------------------------------ nation pick

  private showNation(): void {
    this.screen = 'nation';
    this.preview.show('ussr', 'heavy', 'common', '#33aaff');
    this.ui.innerHTML = `
      <div class="screen nation-screen">
        <div class="logo">ARMOR<span>LINE</span></div>
        <p class="sub">Başlangıç ülkeni seç. O ülkenin 4 tankını (Common) alırsın.</p>
        <div class="nation-list">
          ${NATIONS.map((n) => `
            <button class="nation-card" data-n="${n}">
              <div class="nimgs">${CLASSES.map((c) => `<img src="${tankImg(n, c)}" alt="${TANK_NAMES[n][c]}" loading="lazy">`).join('')}</div>
              <div class="nflag">${NATION_INFO[n].flag}</div>
              <div class="nname">${NATION_INFO[n].name}</div>
              <div class="ntraits">${NATION_INFO[n].traits.map((t) => `<span>${t}</span>`).join('')}</div>
              <div class="ntanks">${CLASSES.map((c) => TANK_NAMES[n][c]).join(' · ')}</div>
            </button>`).join('')}
        </div>
      </div>`;
    this.ui.querySelectorAll<HTMLButtonElement>('.nation-card').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        grantStarterTanks(this.profile, b.dataset.n as Nation);
        this.save();
        this.showGarage();
      }),
    );
  }

  // ------------------------------------------------------------ garage

  private showGarage(): void {
    this.screen = 'garage';
    this.closeModal();
    const p = this.profile;
    const t = selectedTank(p)!;
    const st = tankStats(p, t);
    this.preview.show(t.nation, t.cls, t.rarity, RARITY_INFO[t.rarity].color);

    // Owned tanks grouped by nation (filter chips pick one nation or all).
    const byNation = NATIONS.map((n) => ({
      n,
      tanks: p.tanks
        .filter((x) => x.nation === n)
        .sort((a, b) => CLASSES.indexOf(a.cls) - CLASSES.indexOf(b.cls) || rarityIndex(b.rarity) - rarityIndex(a.rarity)),
    })).filter((g) => g.tanks.length > 0);
    if (this.tankFilter !== 'all' && !byNation.some((g) => g.n === this.tankFilter)) this.tankFilter = 'all';
    const shown = byNation.filter((g) => this.tankFilter === 'all' || g.n === this.tankFilter);
    const tankCard = (x: OwnedTank) => `
              <button class="tank-card ${x.id === t.id ? 'sel' : ''}" data-t="${x.id}" style="--rc:${rarityCss(x.rarity)}">
                <img class="tc-img" src="${tankImg(x.nation, x.cls)}" alt="" loading="lazy">
                <span class="tc-name">${TANK_NAMES[x.nation][x.cls]}</span>
                <span class="tc-cls">${CLASS_INFO[x.cls].short} · Sv.${tankLevel(x)}</span>
              </button>`;
    const winRate = p.stats.battles ? Math.round((p.stats.wins / p.stats.battles) * 100) : 0;

    this.ui.innerHTML = `
      <div class="screen garage">
        <header class="topbar">
          <div class="logo small">ARMOR<span>LINE</span></div>
          <a class="home-link" href="https://dorukplays.com">← dorukplays.com'a dön</a>
          <div class="coins">${coins(p.coins)}</div>
          <button class="icon-btn" data-a="settings" aria-label="Ayarlar">⚙</button>
        </header>

        <div class="tank-title">
          <img class="tphoto" src="${tankImg(t.nation, t.cls)}" alt="${TANK_NAMES[t.nation][t.cls]}" style="--rc:${rarityCss(t.rarity)}">
          <div class="tname">${NATION_INFO[t.nation].flag} ${TANK_NAMES[t.nation][t.cls]}</div>
          <div class="tmeta">${rarityBadge(t.rarity)} <span class="cls">${CLASS_INFO[t.cls].name}</span> <span class="nat">${NATION_INFO[t.nation].name}</span></div>
          <div class="trole">${CLASS_INFO[t.cls].role}</div>
          <div class="tlevel">Seviye <b>${tankLevel(t)}</b><small>/${MAX_LEVEL}</small></div>
        </div>

        <div class="garage-bottom">
          <div class="slots">
            ${SLOTS.map((s) => this.slotHtml(t, s)).join('')}
          </div>
          <div class="weapon-row">
            ${WEAPONS.map((w) => `<button class="wchip ${tankWeapon(t) === w ? 'on' : ''}" data-w="${w}" title="${WEAPON_INFO[w].name}: ${WEAPON_INFO[w].desc}">${WEAPON_ICON[w]} ${WEAPON_SHORT[w]}</button>`).join('')}
          </div>
          <div class="upgrade-row">
            ${[1, 10, 100].map((n) => {
              const u = upgradeTotal(t, n);
              return u.steps === 0
                ? ''
                : `<button class="ui-btn ${p.coins >= u.cost ? 'primary' : ''}" data-up="${n}" ${p.coins >= u.cost ? '' : 'disabled'}>+${u.steps} Sv. ${coins(u.cost)}</button>`;
            }).join('') || '<span class="hint">Maksimum seviye!</span>'}
          </div>
          <details class="stats-box">
            <summary>Özellikler <small>${p.stats.battles} savaş · %${winRate} galibiyet</small></summary>
            ${this.statsHtml(st)}
          </details>
          <div class="nation-chips">
            <button class="chip ${this.tankFilter === 'all' ? 'on' : ''}" data-nf="all">Tümü <small>${p.tanks.length}</small></button>
            ${byNation.map((g) => `<button class="chip ${this.tankFilter === g.n ? 'on' : ''}" data-nf="${g.n}">${NATION_INFO[g.n].flag} ${NATION_INFO[g.n].name} <small>${g.tanks.length}</small></button>`).join('')}
          </div>
          <div class="tank-row">
            ${shown.map((g) => `
              <div class="tgroup">
                <div class="tglabel">${NATION_INFO[g.n].flag} ${NATION_INFO[g.n].name}</div>
                <div class="tgcards">${g.tanks.map(tankCard).join('')}</div>
              </div>`).join('')}
          </div>
          <div class="actions">
            <button class="ui-btn" data-a="parts">🧩 Parçalar <small>${p.parts.length}</small></button>
            <button class="ui-btn" data-a="shop">🛒 Mağaza</button>
            <button class="ui-btn" data-a="help">❔</button>
          </div>
          <div class="mode-row">
            ${([4, 8, 12] as TeamSize[]).map((n) => `<button class="chip ${this.teamSize === n ? 'on' : ''}" data-mode="${n}">${n}v${n}</button>`).join('')}
          </div>
          <button class="battle-btn" data-a="battle">SAVAŞA GİR <small>${this.teamSize}v${this.teamSize}</small></button>
        </div>
      </div>`;

    this.ui.querySelectorAll<HTMLButtonElement>('.tank-card').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        p.selectedTankId = b.dataset.t!;
        this.save();
        this.showGarage();
      }),
    );
    this.ui.querySelectorAll<HTMLButtonElement>('[data-nf]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        this.tankFilter = b.dataset.nf as Nation | 'all';
        this.showGarage();
      }),
    );
    this.ui.querySelectorAll<HTMLButtonElement>('.slot').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        this.openPartPicker(t, b.dataset.s as Slot);
      }),
    );
    this.ui.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        t.weapon = b.dataset.w as WeaponId;
        this.save();
        this.showGarage();
      }),
    );
    this.ui.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) =>
      b.addEventListener('click', () => {
        if (upgradeTank(p, t, Number(b.dataset.up))) {
          sfx.reward();
          this.save();
          this.showGarage();
        }
      }),
    );
    this.ui.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        this.teamSize = Number(b.dataset.mode) as TeamSize;
        localStorage.setItem('armorline.mode', String(this.teamSize));
        this.showGarage();
      }),
    );
    this.on('[data-a=battle]', () => this.startBattle());
    this.on('[data-a=shop]', () => this.openShop());
    this.on('[data-a=parts]', () => this.openInventory());
    this.on('[data-a=settings]', () => this.openSettings());
    this.on('[data-a=help]', () => this.openHelp());
  }

  private on(sel: string, fn: () => void, root: ParentNode = this.ui): void {
    root.querySelector(sel)?.addEventListener('click', () => {
      sfx.click();
      fn();
    });
  }

  private slotHtml(t: OwnedTank, s: Slot): string {
    const id = t.equipped[s];
    const part = id ? this.profile.parts.find((x) => x.id === id) : undefined;
    const info = SLOT_INFO[s];
    if (!part) {
      return `<button class="slot empty" data-s="${s}"><span class="sicon">${info.icon}</span><span class="sname">${info.name}</span><span class="sr">Boş</span></button>`;
    }
    return `<button class="slot" data-s="${s}" style="--rc:${rarityCss(part.rarity)}"><span class="sicon">${info.icon}</span><span class="sname">${info.name}</span><span class="sr">${RARITY_INFO[part.rarity].name}</span></button>`;
  }

  private statsHtml(s: TankStats): string {
    const row = (label: string, val: string, pct: number) =>
      `<div class="srow"><span>${label}</span><div class="sbar"><div style="width:${Math.max(4, Math.min(100, pct))}%"></div></div><b>${val}</b></div>`;
    const dpm = (s.damage * 60 * s.magazine) / (s.reload + s.clipInterval * (s.magazine - 1));
    return `<div class="stats">
      ${row('Can', Math.round(s.hp).toString(), (s.hp / 3500) * 100)}
      ${row('Hasar', Math.round(s.damage).toString(), (s.damage / 900) * 100)}
      ${row('Delicilik', Math.round(s.pen) + ' mm', (s.pen / 400) * 100)}
      ${row(s.magazine > 1 ? `Şarjör (${s.magazine})` : 'Dolum', s.reload.toFixed(1) + ' s', (1 - s.reload / 32) * 100)}
      ${row('Dakika hasarı', Math.round(dpm).toString(), (dpm / 5000) * 100)}
      ${row('Gövde zırhı', `${Math.round(s.hullArmor.front)}/${Math.round(s.hullArmor.side)}/${Math.round(s.hullArmor.rear)}`, (s.hullArmor.front / 300) * 100)}
      ${row('Taret zırhı', `${Math.round(s.turretArmor.front)}/${Math.round(s.turretArmor.side)}/${Math.round(s.turretArmor.rear)}`, (s.turretArmor.front / 350) * 100)}
      ${row('Sektirme', Math.round(s.ricochet * 100) + '%', s.ricochet * 100)}
      ${row('Hız', (s.speed * 3.6).toFixed(0) + ' km/s', (s.speed / 32) * 100)}
      ${row('Dönüş', Math.round(s.hullTraverse) + '°/s', (s.hullTraverse / 160) * 100)}
      ${row('Taret dönüşü', Math.round(s.turretTraverse) + '°/s', (s.turretTraverse / 140) * 100)}
      ${row('Görüş', Math.round(s.view) + ' m', (s.view / 130) * 100)}
      ${row('İsabet', (s.dispersion * 100).toFixed(2), (1 - s.dispersion / 0.05) * 100)}
      ${row('Nişan süresi', s.aimTime.toFixed(1) + ' s', (1 - s.aimTime / 5) * 100)}
      ${row('Top eğilmesi', '-' + s.gunDepression.toFixed(0) + '°', (s.gunDepression / 15) * 100)}
      ${row('Zoom', '×' + s.zoom.toFixed(1), (s.zoom / 6) * 100)}
      ${row('Delme tahmini', s.opticLevel >= 8 ? 'Kusursuz' : '±%' + Math.round(OPTIC_ERROR[s.opticLevel] * 100), (s.opticLevel / 8) * 100)}
      ${row('Ram gücü', '×' + s.ramPower.toFixed(2), (s.ramPower * s.mass / 3) * 100)}
    </div>`;
  }

  // ------------------------------------------------------------ modals

  private openModal(kind: string, title: string, body: string): HTMLDivElement {
    this.closeModal();
    const m = document.createElement('div');
    m.className = 'modal-wrap';
    m.dataset.kind = kind;
    m.innerHTML = `<div class="modal"><header><h2>${title}</h2><button class="icon-btn close" aria-label="Kapat">✕</button></header><div class="modal-body">${body}</div></div>`;
    this.ui.appendChild(m);
    m.querySelector('.close')!.addEventListener('click', () => {
      sfx.click();
      this.closeModal();
    });
    m.addEventListener('click', (e) => {
      if (e.target === m) this.closeModal();
    });
    this.modal = m;
    return m;
  }

  private closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  private partCard(part: Part, extra: string): string {
    const owner = partOwner(this.profile, part.id);
    return `<div class="part-card" style="--rc:${rarityCss(part.rarity)}">
      <div class="pc-head"><span class="pc-icon">${SLOT_INFO[part.slot].icon}</span>
        <div><div class="pc-name">${esc(partName(part))}</div>${rarityBadge(part.rarity)}</div></div>
      <ul class="pc-eff">${partEffects(part).map((e) => `<li>${e}</li>`).join('')}</ul>
      ${owner ? `<div class="pc-owner">Takılı: ${TANK_NAMES[owner.nation][owner.cls]} (${RARITY_INFO[owner.rarity].name})</div>` : ''}
      <div class="pc-actions">${extra}</div>
    </div>`;
  }

  private openPartPicker(t: OwnedTank, slot: Slot): void {
    const p = this.profile;
    const parts = p.parts
      .filter((x) => x.slot === slot && x.nation === t.nation)
      .sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity));
    const current = t.equipped[slot];
    const body = `
      <p class="hint">${NATION_INFO[t.nation].name} tankına sadece ${NATION_INFO[t.nation].name} parçaları takılır.</p>
      ${current ? `<button class="ui-btn danger wide" data-unequip>Parçayı çıkar</button>` : ''}
      <div class="part-grid">
        ${parts.length === 0 ? `<p class="empty-msg">Bu slot için ${NATION_INFO[t.nation].name} parçan yok. Savaş kazan ya da mağazaya bak.</p>` : ''}
        ${parts.map((x) => this.partCard(x, x.id === current ? `<span class="equipped">✓ Takılı</span>` : `<button class="ui-btn primary" data-eq="${x.id}">Tak</button>`)).join('')}
      </div>`;
    const m = this.openModal('picker', `${SLOT_INFO[slot].icon} ${SLOT_INFO[slot].name}`, body);
    m.querySelector('[data-unequip]')?.addEventListener('click', () => {
      sfx.click();
      unequipSlot(t, slot);
      this.save();
      this.showGarage();
    });
    m.querySelectorAll<HTMLButtonElement>('[data-eq]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        const part = p.parts.find((x) => x.id === b.dataset.eq);
        if (part) equipPart(p, t, part);
        this.save();
        this.showGarage();
      }),
    );
  }

  private openInventory(filter: Nation | 'all' = 'all'): void {
    const p = this.profile;
    const parts = p.parts
      .filter((x) => filter === 'all' || x.nation === filter)
      .sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    const body = `
      <div class="filters">
        <button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">Tümü</button>
        ${NATIONS.map((n) => `<button class="chip ${filter === n ? 'on' : ''}" data-f="${n}">${NATION_INFO[n].flag} ${NATION_INFO[n].name}</button>`).join('')}
      </div>
      <div class="part-grid">
        ${parts.length === 0 ? '<p class="empty-msg">Henüz parçan yok. Savaşlarda düşer ya da mağazadan alınır.</p>' : ''}
        ${parts.map((x) => this.partCard(x, `<button class="ui-btn" data-sell="${x.id}">Sat ${coins(sellValue(x.rarity))}</button>`)).join('')}
      </div>`;
    const m = this.openModal('inventory', '🧩 Parçalar', body);
    m.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) =>
      b.addEventListener('click', () => this.openInventory(b.dataset.f as Nation | 'all')),
    );
    m.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.confirm !== '1') {
          b.dataset.confirm = '1';
          b.textContent = 'Emin misin?';
          return;
        }
        sellPart(p, b.dataset.sell!);
        sfx.reward();
        this.save();
        this.showGarage();
        this.openInventory(filter);
      }),
    );
  }

  private openShop(): void {
    const p = this.profile;
    const offers = shopOffers(p);
    const chances = rarityChances();
    const body = `
      <div class="shop-head"><span class="coins">${coins(p.coins)}</span><span class="shop-timer"></span></div>
      <div class="part-grid">
        ${offers.map((o) => this.partCard(o.part, o.sold
          ? '<span class="equipped">Satın alındı</span>'
          : `<button class="ui-btn primary" data-buy="${o.index}" ${p.coins < o.price ? 'disabled' : ''}>Al ${coins(o.price)}</button>`)).join('')}
      </div>
      <details class="odds"><summary>Nadirlik olasılıkları</summary>
        ${RARITIES.map((r) => `<div class="odd">${rarityBadge(r)} <span>%${(chances[r] * 100).toFixed(1)}</span> <span>${coins(RARITY_INFO[r].price)}</span></div>`).join('')}
      </details>
      <p class="hint">Mağaza her 5 dakikada bir yenilenir. Parçalar sadece kendi ülkesinin tanklarına takılır.</p>`;
    const m = this.openModal('shop', '🛒 Mağaza', body);
    this.shopTimer = 0;
    m.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const o = offers[Number(b.dataset.buy)];
        if (buyOffer(p, o)) {
          sfx.reward();
          this.save();
          this.showGarage();
          this.openShop();
        }
      }),
    );
  }

  private openSettings(): void {
    const body = `
      <div class="setting"><span>Grafik kalitesi</span>
        <div><button class="chip ${this.quality === 'high' ? 'on' : ''}" data-q="high">Yüksek</button><button class="chip ${this.quality === 'low' ? 'on' : ''}" data-q="low">Düşük</button></div></div>
      <div class="setting"><span>Ses</span><button class="chip ${isMuted() ? '' : 'on'}" data-mute>${isMuted() ? 'Kapalı' : 'Açık'}</button></div>
      <div class="setting"><span>Diğer oyunlar</span><a class="ui-btn" href="https://dorukplays.com">dorukplays.com'a dön</a></div>
      <div class="setting"><span>İlerlemeyi sıfırla</span><button class="ui-btn danger" data-reset>Sıfırla</button></div>
      <p class="hint">İlerlemen bu tarayıcıda saklanır.</p>`;
    const m = this.openModal('settings', '⚙ Ayarlar', body);
    m.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        this.quality = b.dataset.q as 'high' | 'low';
        localStorage.setItem('armorline.quality', this.quality);
        this.resize();
        this.openSettings();
      }),
    );
    m.querySelector('[data-mute]')!.addEventListener('click', () => {
      setMuted(!isMuted());
      this.openSettings();
    });
    m.querySelector<HTMLButtonElement>('[data-reset]')!.addEventListener('click', (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      if (b.dataset.confirm !== '1') {
        b.dataset.confirm = '1';
        b.textContent = 'Tüm tanklar ve parçalar silinecek. Emin misin?';
        return;
      }
      this.profile = resetProfile();
      this.showNation();
    });
  }

  private openHelp(): void {
    const body = `
      <h3>Kontroller</h3>
      <p><b>Telefon:</b> Sol tarafa dokunup sürükle → sür. Sağ tarafı sürükle → nişan/kamera. ATEŞ butonu → ateş. 🔭 → zoom. 🎯 → topçu görünümü (Artillery).</p>
      <p><b>Bilgisayar:</b> WASD → sür. Fare → nişan (ekrana tıkla). Sol tık / Space → ateş. Sağ tık / Shift → zoom. E → topçu görünümü. Esc → fareyi bırak.</p>
      <h3>Savaş</h3>
      <p>5'e 5 savaş, 5 dakika. Rakip takımı yok et ya da süre bittiğinde daha çok canla kal.</p>
      <p>Düşmanları ancak takımından biri görürse görürsün (spot). Mobil tanklar en iyi gözcülerdir.</p>
      <p>Mermi zırhı delerse hasar verir. Eğimli zırh daha kalındır, çok açılı vuruşlar sekebilir. Optic parçası, nişan aldığın yerin delinip delinmeyeceğini renkle gösterir (kırmızı: delemez, yeşil: deler).</p>
      <h3>Modlar ve silahlar</h3>
      <p>4v4, 8v8 ve 12v12 savaşlar var; büyük modlarda harita da büyür. Her maçta harita yeniden üretilir.</p>
      <p>Her tanka 4 silahtan birini seçebilirsin: Ağır (uzun dolum, güçlü), Standart, Hızlı (kısa dolum, az hasar) ve Şarjörlü (4 mermi, sonra uzun dolum).</p>
      <p>Para ile tankının seviyesini yükseltebilirsin (1–1000); her seviye can, hasar, zırh ve delme ekler.</p>
      <h3>Hasar sistemi</h3>
      <p>Yakıt deposunu (arka yanlar) delersen tank yanar ve saniye başı hasar alır. Taretin arkasındaki dolum bölmesini delersen rakibin dolum süresi iki katına çıkar. Paleti vurursan palet kopar, 2 saniye hareket edemez.</p>
      <p>Elektrik Kalkanı 20 saniyede dolar; doluyken hasarın bir kısmını durdurur. Art arda vurulursa toparlanamaz.</p>
      <h3>Ödüller</h3>
      <p>Verdiğin hasar, imha (+${COINS_PER_KILL}) ve asist (+${COINS_PER_ASSIST}) kadar para kazanırsın (galibiyette 2 katı). Galibiyette %${DROP_CHANCE.tank.win * 100} tank, %${DROP_CHANCE.part.win * 100} parça; mağlubiyette %${DROP_CHANCE.tank.loss * 100} tank, %${DROP_CHANCE.part.loss * 100} parça şansı.</p>`;
    this.openModal('help', '❔ Nasıl oynanır', body + `<h3>Krediler</h3><p>Tank modelleri: Quaternius, "Animated Tank Pack" (CC0).</p>`);
  }

  // ------------------------------------------------------------ battle

  private startBattle(): void {
    unlockAudio();
    const p = this.profile;
    const t = selectedTank(p)!;
    this.closeModal();
    this.ui.innerHTML = '';
    this.screen = 'battle';
    this.battle = new Battle(
      this.renderer,
      this.ui,
      { spec: { nation: t.nation, cls: t.cls, rarity: t.rarity, stats: tankStats(p, t) }, name: 'Sen', level: tankLevel(t) },
      { quality: this.quality, teamSize: this.teamSize },
      (r) => this.finishBattle(r),
      () =>
        this.finishBattle(
          { win: false, draw: false, damage: 0, kills: 0, assists: 0, survived: false, scoreboard: [], teamSize: this.teamSize },
          true,
        ),
    );
    this.resize();
  }

  private finishBattle(r: BattleResult, quit = false): void {
    this.battle = null;
    if (document.pointerLockElement) document.exitPointerLock();
    const reward = quit ? rollRewards(false, 0) : rollRewards(r.win, r.damage, Math.random, r.kills, r.assists);
    applyReward(this.profile, reward);
    this.save();
    this.showGarage();
    this.showResult(r, reward);
  }

  private showResult(r: BattleResult, rw: BattleReward): void {
    const title = r.draw ? 'BERABERE' : r.win ? 'ZAFER' : 'YENİLGİ';
    const drops: string[] = [];
    if (rw.tank) {
      const t = rw.tank;
      drops.push(`<div class="drop" style="--rc:${rarityCss(t.rarity)}">
        <div class="drop-kind">YENİ TANK</div>
        <img class="drop-img" src="${tankImg(t.nation, t.cls)}" alt="">
        <div class="drop-name">${NATION_INFO[t.nation].flag} ${TANK_NAMES[t.nation][t.cls]}</div>
        ${rarityBadge(t.rarity)} <span class="cls">${CLASS_INFO[t.cls].name}</span>
        ${rw.duplicateCoins ? `<div class="dup">Zaten vardı → ${coins(rw.duplicateCoins)}</div>` : ''}
      </div>`);
    }
    if (rw.part) {
      drops.push(`<div class="drop" style="--rc:${rarityCss(rw.part.rarity)}">
        <div class="drop-kind">YENİ PARÇA</div>
        <div class="drop-name">${SLOT_INFO[rw.part.slot].icon} ${esc(partName(rw.part))}</div>
        ${rarityBadge(rw.part.rarity)}
      </div>`);
    }
    const body = `
      <div class="result ${r.win ? 'win' : r.draw ? 'draw' : 'loss'}">
        <div class="res-title">${title}</div>
        <div class="res-stats">
          <div><b>${r.damage}</b><span>Hasar</span></div>
          <div><b>${r.kills}</b><span>İmha</span></div>
          <div><b>${r.assists}</b><span>Asist</span></div>
          <div><b>${r.survived ? 'Evet' : 'Hayır'}</b><span>Hayatta</span></div>
        </div>
        <div class="res-coins">+${coins(rw.coins)} ${r.win ? '<small>(galibiyet ×2)</small>' : ''}</div>
        <div class="res-break hint">Hasar ${Math.round(r.damage * COINS_PER_DAMAGE)} + İmha ${r.kills}×${COINS_PER_KILL} + Asist ${r.assists}×${COINS_PER_ASSIST}${r.win ? ' → ×2' : ''}</div>
        <div class="drops">${drops.length ? drops.join('') : '<p class="hint">Bu sefer tank ya da parça düşmedi.</p>'}</div>
        ${r.scoreboard.length ? `<details class="res-board" open><summary>Oyun tablosu (${r.teamSize}v${r.teamSize})</summary>${scoreboardHtml(r.scoreboard)}</details>` : ''}
        <button class="battle-btn" data-again>TEKRAR SAVAŞ</button>
      </div>`;
    const m = this.openModal('result', 'Savaş sonucu', body);
    if (drops.length) sfx.reward();
    m.querySelector('[data-again]')!.addEventListener('click', () => this.startBattle());
  }
}
