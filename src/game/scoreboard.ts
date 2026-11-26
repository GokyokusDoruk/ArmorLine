import { CLASS_INFO, NATION_INFO, type Nation, type TankClass } from '../data/tanks';

export interface ScoreRow {
  name: string;
  model: string;
  nation: Nation;
  cls: TankClass;
  team: 0 | 1;
  isPlayer: boolean;
  alive: boolean;
  damage: number;
  kills: number;
  assists: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Two-team table: tank, damage, kills, assists. Used in battle and on the result screen. */
export function scoreboardHtml(rows: ScoreRow[]): string {
  const team = (t: 0 | 1, title: string) => {
    const list = rows.filter((r) => r.team === t);
    const total = list.reduce((s, r) => s + r.damage, 0);
    return `<div class="sb-team sb-${t === 0 ? 'ally' : 'enemy'}">
      <div class="sb-title">${title} <small>${list.filter((r) => r.alive).length}/${list.length} hayatta · ${total} hasar</small></div>
      <table>
        <thead><tr><th>Tank</th><th>Hasar</th><th>İmha</th><th>Asist</th></tr></thead>
        <tbody>${list
          .map(
            (r) => `<tr class="${r.isPlayer ? 'me' : ''} ${r.alive ? '' : 'dead'}">
          <td><span class="sb-name">${NATION_INFO[r.nation].flag} ${esc(r.model)} <small>${CLASS_INFO[r.cls].short}</small></span><small class="sb-pl">${esc(r.name)}</small></td>
          <td>${r.damage}</td><td>${r.kills}</td><td>${r.assists}</td></tr>`,
          )
          .join('')}</tbody>
      </table></div>`;
  };
  return `<div class="sb">${team(0, 'Senin takımın')}${team(1, 'Rakip takım')}</div>`;
}
