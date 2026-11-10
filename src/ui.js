// DOM menus: title, workshop, pause, death and victory screens.
import { UPGRADES, WEAPONS, BOSSES, ITEMS } from './config.js';

const $ = (id) => document.getElementById(id);
const COST_NAMES = { wood: 'древесины', ore: 'руды', crystal: 'кристаллов' };
const WALLET = ['essence', 'wood', 'ore', 'crystal'];

export class UI {
  // on: { newGame, continueGame, resume, respawn, toMenu, toggleSound, buyUpgrade(id), craft(id) }
  constructor(on) {
    this.panels = ['title', 'craft', 'pause', 'dead', 'win'].map($);
    $('btn-new').addEventListener('click', on.newGame);
    $('btn-continue').addEventListener('click', on.continueGame);
    $('btn-resume').addEventListener('click', on.resume);
    $('btn-win').addEventListener('click', on.resume);
    $('craft-close').addEventListener('click', on.resume);
    $('btn-respawn').addEventListener('click', on.respawn);
    $('btn-menu').addEventListener('click', on.toMenu);
    $('btn-sound').addEventListener('click', on.toggleSound);
    $('craft').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-upg], button[data-craft]');
      if (!b || b.disabled) return;
      if (b.dataset.upg) on.buyUpgrade(b.dataset.upg);
      else on.craft(b.dataset.craft);
    });
  }

  // Shows one panel (or none) and moves keyboard focus to its first usable button.
  show(id) {
    for (const p of this.panels) p.hidden = p.id !== id;
    const first = id && $(id).querySelector('button:not([hidden]):not(:disabled)');
    if (first) first.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  setContinue(has) { $('btn-continue').hidden = !has; }

  setSound(on) { $('btn-sound').textContent = `Звук: ${on ? 'вкл' : 'выкл'}`; }

  setDeath(lost) {
    $('dead-info').textContent = lost > 0
      ? `Потеряно эссенции: ${lost}. Ресурсы, оружие, улучшения и посевы остались при тебе.`
      : 'Ресурсы, оружие, улучшения и посевы остались при тебе.';
  }

  setWin(game) {
    const ids = Object.keys(BOSSES), beaten = ids.filter((id) => game.bossKills[id]).length;
    $('win-info').textContent = `Игнис пал, и витраж снова сияет. Хранителей повержено: ${beaten} из ${ids.length}, тварей побеждено: ${game.stats.kills}, `
      + `урожаев собрано: ${game.stats.harvested}, дней в пути: ${game.day}. Мир бесконечен — Хранителей можно пробуждать вновь, и с каждым разом они сильнее.`;
  }

  // focus: selector of the button to refocus after a purchase re-rendered the lists
  renderCraft(game, focus) {
    $('wallet').innerHTML = WALLET.map((k) => `<span title="${ITEMS[k].name}"><i class="gem ${k}"></i>${game.inv[k]}</span>`).join('');
    $('upg-list').innerHTML = UPGRADES.map((u) => {
      const lvl = game.upg[u.id], cost = game.upgradeCost(u.id);
      const side = lvl >= u.max
        ? '<span class="owned">максимум</span>'
        : `<button class="btn small" data-upg="${u.id}" aria-label="${u.name}: улучшить за ${cost} эссенции"${game.inv.essence >= cost ? '' : ' disabled'}>${cost}<i class="gem essence"></i></button>`;
      return `<li class="row"><div class="info"><b>${u.name}</b><span class="pips">${'◆'.repeat(lvl)}${'◇'.repeat(u.max - lvl)}</span><small>${u.desc}</small></div>${side}</li>`;
    }).join('');
    $('weapon-list').innerHTML = WEAPONS.map((w, i) => {
      let need = '', side = `<span class="owned">в арсенале · клавиша ${i + 1}</span>`;
      if (!game.unlocked[w.id]) {
        const parts = Object.entries(w.cost).map(([k, n]) => `<span class="${game.inv[k] >= n ? 'ok' : 'lack'}">${n} ${COST_NAMES[k]}</span>`);
        if (w.core) parts.push(`<span class="${game.cores[w.core] ? 'ok' : 'lack'}">ядро: ${BOSSES[w.core].name}</span>`);
        need = `<small>${parts.join(' · ')}</small>`;
        side = `<button class="btn small" data-craft="${w.id}" aria-label="Создать: ${w.name}"${game.canCraft(w.id) ? '' : ' disabled'}>Создать</button>`;
      }
      return `<li class="row"><div class="info"><b style="color:${w.color}">${w.name}</b><small>${w.desc}</small>${need}</div>${side}</li>`;
    }).join('');
    $('core-list').innerHTML = Object.entries(BOSSES).map(([id, b]) => {
      const n = game.bossKills[id] || 0;
      return `<li class="${n ? 'ok' : ''}"><i class="gem" style="background:${b.color}"></i><b>${b.name}</b> — ${b.title}: ${n ? `повержен ×${n}` : 'не побеждён'}</li>`;
    }).join('');
    const again = focus && $('craft').querySelector(focus);
    if (again && !again.disabled) again.focus({ preventScroll: true });
    else if (focus) $('craft-close').focus({ preventScroll: true });
  }
}
