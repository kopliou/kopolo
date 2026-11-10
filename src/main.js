// Entry point: owns the game loop, the screen state machine and the glue between input, simulation, renderer, HUD, sound and saves.
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { UI } from './ui.js';
import { readSave, writeSave, clearSave, readMuted, writeMuted } from './save.js';
import { WEAPONS, CROPS } from './config.js';

const TIPS = [
  'WASD — движение · ЛКМ — огонь · Пробел — рывок сквозь снаряды',
  'Стреляй по деревьям, камням и кристаллам — из них сыплются ресурсы',
  'F — посадить семя перед собой · E — собрать созревший урожай',
  'Z — съесть светоягоду и вылечиться · у Маяка здоровье восстанавливается само',
  'Tab — мастерская: улучшения за эссенцию и новое оружие',
  'M — карта с алтарями Хранителей · T (удерживать) — возврат к Маяку',
];
const DEMO_SEED = 20241;

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const hud = new Hud();
const input = new Input(canvas);
const sfx = new Sfx();

let game = new Game({ seed: DEMO_SEED }); // a live world also runs behind the title screen
let mode = 'title'; // title | play | craft | pause | map | dead | win
let toasts = [];
let clock = 0, playT = 0, saveT = 0, deadT = 0, winT = 0, last = performance.now();

function toast(text, tone) {
  toasts.push({ text, tone, age: 0, life: 4 });
  if (toasts.length > 4) toasts.shift();
}

function save() {
  if (mode !== 'title' && game.player.alive) writeSave(game.serialize());
}

function setMode(next) {
  mode = next;
  input.reset();
  document.body.classList.toggle('playing', next === 'play');
  if (next === 'title') ui.setContinue(!!readSave());
  if (next === 'craft') ui.renderCraft(game);
  if (next === 'win') ui.setWin(game);
  ui.show(next === 'play' || next === 'map' || next === 'dead' ? null : next); // the death panel appears after a short beat
}

function start(next) {
  game = next;
  toasts = [];
  playT = saveT = winT = 0;
  renderer.reset();
  sfx.unlock();
  setMode('play');
  save();
}

function setMuted(muted) {
  sfx.setMuted(muted);
  writeMuted(muted);
  ui.setSound(!muted);
}

// Applies the simulation's events: particles, sound, toasts and screen changes.
function drain(silent) {
  for (const e of game.events) {
    renderer.onEvent(e);
    if (silent) continue;
    sfx.onEvent(e);
    switch (e.type) {
      case 'toast': toast(e.text, e.tone); break;
      case 'eat': toast(`${CROPS[e.kind].name}: ${CROPS[e.kind].use}`, 'good'); break;
      case 'bossStart': toast(`${e.title} пробуждается: ${e.name}!`, 'boss'); break;
      case 'bossPhase': toast(`${e.name} впадает в ярость`, 'boss'); break;
      case 'bossDead': {
        toast(`${e.name} повержен!`, 'good');
        const w = WEAPONS.find((x) => x.core === e.id);
        if (e.first && w) toast(`Добыто ядро Хранителя — в мастерской (Tab) теперь можно создать «${w.name}»`, 'good');
        save();
        break;
      }
      case 'victory': winT = 3; break;
      case 'death':
        ui.setDeath(e.lost);
        deadT = 1.3;
        setMode('dead');
        break;
    }
  }
  game.events.length = 0;
}

const ui = new UI({
  newGame() {
    clearSave();
    start(new Game());
    toast('Маяк — твой дом: он лечит и отгоняет тварей', 'day');
  },
  continueGame() {
    const data = readSave();
    let loaded = null;
    if (data) {
      try { loaded = new Game({ save: data }); } catch { loaded = null; } // a broken save falls back to a fresh world
    }
    start(loaded || new Game());
  },
  resume() {
    if (mode === 'craft' || mode === 'pause' || mode === 'win') setMode('play');
  },
  respawn() {
    if (mode !== 'dead' || deadT > 0) return;
    game.respawn();
    setMode('play');
    save();
  },
  toMenu() {
    save();
    game = new Game({ seed: DEMO_SEED });
    toasts = [];
    setMode('title');
  },
  toggleSound() { setMuted(!sfx.muted); },
  buyUpgrade(id) {
    game.buyUpgrade(id);
    drain();
    ui.renderCraft(game, `[data-upg="${id}"]`);
  },
  craft(id) {
    if (game.craft(id)) toast(`«${WEAPONS[game.player.weapon].name}» в арсенале`, 'good');
    drain();
    ui.renderCraft(game, `[data-craft="${id}"]`);
  },
});

// Tells the input layer which keys the game currently owns (see Input.guard).
input.guard = () => (mode === 'title' ? 'menu' : mode === 'play' ? 'play' : 'overlay');

function handleKeys() {
  const pr = input.pressed;
  if (pr.has('KeyN') && mode !== 'title') setMuted(!sfx.muted);
  switch (mode) {
    case 'play':
      if (pr.has('Tab') || pr.has('KeyB')) setMode('craft');
      else if (pr.has('Escape') || pr.has('KeyP')) { save(); setMode('pause'); }
      else if (pr.has('KeyM')) setMode('map');
      break;
    case 'craft':
      if (pr.has('Tab') || pr.has('KeyB') || pr.has('Escape')) setMode('play');
      break;
    case 'pause':
      if (pr.has('Escape') || pr.has('KeyP')) setMode('play');
      break;
    case 'map':
      if (pr.has('KeyM') || pr.has('Escape') || pr.has('Tab')) setMode('play');
      break;
    case 'win':
      if (pr.has('Escape')) setMode('play');
      break;
  }
}

function feedInput() {
  const k = input.down, pr = input.pressed, inp = game.input;
  const aim = renderer.screenToWorld(input.mouse.x, input.mouse.y);
  inp.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  inp.my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
  inp.aimX = aim.x; inp.aimY = aim.y;
  inp.fire = input.mouse.left;
  inp.recall = k.has('KeyT');
  if (pr.has('Space') || pr.has('ShiftLeft') || pr.has('ShiftRight') || pr.has('MouseRight')) inp.dash = true;
  if (pr.has('KeyE')) inp.interact = true;
  if (pr.has('KeyF')) inp.plant = true;
  if (pr.has('KeyQ')) inp.cycleSeed = true;
  if (pr.has('KeyZ')) inp.eat = 'berry';
  else if (pr.has('KeyX')) inp.eat = 'pepper';
  else if (pr.has('KeyC')) inp.eat = 'frost';
  for (let i = 0; i < WEAPONS.length; i++) if (pr.has('Digit' + (i + 1))) inp.weapon = i;
  if (input.wheel) inp.wheel = Math.sign(input.wheel);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;
  handleKeys();

  const running = mode === 'play' || mode === 'dead' || mode === 'title';
  if (running) {
    if (mode === 'play') feedInput();
    else { game.input.mx = game.input.my = 0; game.input.fire = game.input.recall = false; }
    // two half steps keep fast projectiles honest on slow frames
    const steps = dt > 1 / 45 ? 2 : 1;
    for (let i = 0; i < steps; i++) game.update(dt / steps);
    drain(mode === 'title');
    for (let i = toasts.length - 1; i >= 0; i--) {
      toasts[i].age += dt;
      if (toasts[i].age >= toasts[i].life) toasts.splice(i, 1);
    }
  }
  if (mode === 'play') {
    playT += dt;
    saveT += dt;
    if (saveT > 12) { saveT = 0; save(); }
    if (winT > 0 && (winT -= dt) <= 0) setMode('win');
  } else if (mode === 'dead' && deadT > 0 && (deadT -= dt) <= 0) ui.show('dead');

  const camera = mode === 'title' ? { x: Math.cos(clock * 0.07) * 380, y: 40 + Math.sin(clock * 0.09) * 230 } : null;
  renderer.draw(game, running ? dt : 0, { mouse: mode === 'play' ? input.mouse : null, camera });
  if (mode !== 'title') {
    const hint = playT < 72 ? TIPS[Math.floor(playT / 12) % TIPS.length] : null;
    hud.draw(renderer.ctx, renderer, game, { mode, toasts, mouse: input.mouse, hint });
  }
  input.endFrame();
}

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  save();
  if (mode === 'play') setMode('pause');
});

// Small console handle for debugging and automated checks.
window.kopolo = { get game() { return game; }, get mode() { return mode; }, renderer };

sfx.setMuted(readMuted());
ui.setSound(!sfx.muted);
setMode('title');
requestAnimationFrame(frame);
