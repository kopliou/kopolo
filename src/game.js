// Headless game simulation (no DOM): the browser front-end and `node --test` both drive it.
import {
  TILE, DAY_LENGTH, HOME_RADIUS, RECALL_TIME, BIOME_IDS, BIOMES, WEAPONS, UPGRADES, CROPS, MOBS, BIOME_MOBS, BOSSES,
} from './config.js';
import { TAU, clamp, smooth, dist2, mulberry32, angDiff, segCircle } from './util.js';
import { World } from './world.js';
import { spawnBoss, updateBoss, bossParts, damageBoss } from './bosses.js';

const DASH_TIME = 0.17;
const DASH_SPEED = 820;
const AGGRO = 740;
const DESPAWN = 1500;
const CROP_IDS = Object.keys(CROPS);
const WISP_SHOT = { r: 6, color: '#6a5aff', homing: 1.3, life: 3.2 };
const YETI_SHOT = { r: 7, color: '#4a7aff', life: 2.2 };
const SENT_SHOT = { r: 6, color: '#ffe04a', life: 3.2 };

// Held inputs persist; the edge-triggered ones are cleared at the end of every update.
export const newInput = () => ({
  mx: 0, my: 0, aimX: 0, aimY: 0, fire: false, recall: false,
  dash: false, interact: false, plant: false, cycleSeed: false, eat: null, weapon: -1, wheel: 0,
});

// Shared scratch for node push-out so the hot path allocates no closures.
let pushE = null;
function pushOut(n) {
  if (!n.def.solid) return;
  const dx = pushE.x - n.x, dy = pushE.y - n.y;
  const d = Math.hypot(dx, dy) || 0.01;
  const o = pushE.r + n.r - d;
  if (o > 0) { pushE.x += (dx / d) * o; pushE.y += (dy / d) * o; }
}

function pick(table, u) {
  let total = 0, acc = 0;
  for (const [, w] of table) total += w;
  for (const [id, w] of table) { acc += w / total; if (u < acc) return id; }
  return table[0][0];
}

export class Game {
  constructor(opts = {}) {
    const save = opts.save || null;
    this.seed = save ? save.seed | 0 : opts.seed ?? ((Math.random() * 0x7fffffff) | 0);
    this.world = new World(this.seed);
    this.rng = mulberry32(this.seed ^ 0x51ed270b);
    this.time = DAY_LENGTH * 0.06;
    this.darkness = 0;
    this.day = 1;
    this.started = false;
    this.player = {
      x: 0, y: 70, vx: 0, vy: 0, kx: 0, ky: 0, r: 14, hp: 100, aim: 0, weapon: 0, cool: 0,
      dashT: 0, dashCd: 0, dashMax: 1, dashDx: 1, dashDy: 0, invuln: 1, hurtT: 0, eatCd: 0, burnT: 0, recall: 0,
      plantHint: 0, alive: true, inLiquid: false, atHome: true, biome: 0, seedSel: 'berry', buffs: { rage: 0, frost: 0 },
    };
    this.inv = { wood: 0, ore: 0, crystal: 0, essence: 0, seedBerry: 3, seedPepper: 0, seedFrost: 0, berry: 2, pepper: 0, frost: 0 };
    this.upg = {};
    for (const u of UPGRADES) this.upg[u.id] = 0;
    this.unlocked = { shard: true };
    this.cores = {};
    this.bossKills = {};
    this.stats = { kills: 0, harvested: 0, deaths: 0 };
    this.won = false;
    this.crops = new Map(); // "tx,ty" -> { type, tx, ty, x, y, t0, dur }
    this.bullets = [];
    this.ebullets = [];
    this.mobs = [];
    this.pickups = [];
    this.hazards = [];
    this.boss = null;
    this.events = []; // drained by the front-end for sound, particles and toasts
    this.input = newInput();
    this.prompt = null;
    this.spot = null;
    this.spawnT = 2;
    this.pruneT = 4;
    this.recallWarned = false;
    if (save) this.applySave(save);
    this.st = this.derived();
    this.updateDay();
  }

  emit(type, x, y, data) {
    const e = data || {};
    e.type = type; e.x = x; e.y = y;
    this.events.push(e);
  }

  toast(text, tone) { this.emit('toast', 0, 0, { text, tone }); }

  derived() {
    const u = this.upg, b = this.player.buffs;
    return {
      maxHp: 100 + 20 * u.hp,
      dmgMul: (1 + 0.12 * u.dmg) * (b.rage > 0 ? 1.4 : 1),
      rateMul: 1 + 0.08 * u.rate,
      speed: 245 * (1 + 0.05 * u.speed) * (b.frost > 0 ? 1.15 : 1),
      magnet: 95 * (1 + 0.35 * u.magnet),
      dashCd: 1.25 * Math.pow(0.88, u.dash),
      regen: 0.5 * u.regen,
    };
  }

  update(dt) {
    if (this.events.length > 3000) this.events.length = 0;
    this.time += dt;
    this.world.now = this.time;
    this.updateDay();
    this.st = this.derived();
    const p = this.player;
    if (p.hp > this.st.maxHp) p.hp = this.st.maxHp;
    if (p.alive) this.updatePlayer(dt);
    this.updateBullets(dt);
    this.updateMobs(dt);
    if (this.boss) updateBoss(this, this.boss, dt);
    this.updateEnemyBullets(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    this.updateSpawner(dt);
    this.updatePrompt();
    this.pruneT -= dt;
    if (this.pruneT <= 0) { this.pruneT = 4; this.world.prune(p.x, p.y); }
    const inp = this.input;
    inp.dash = inp.interact = inp.plant = inp.cycleSeed = false;
    inp.eat = null; inp.weapon = -1; inp.wheel = 0;
  }

  updateDay() {
    const ph = (this.time % DAY_LENGTH) / DAY_LENGTH;
    const wasNight = this.darkness > 0.5;
    this.darkness = smooth(0.58, 0.68, ph) - smooth(0.93, 1, ph);
    this.day = 1 + Math.floor(this.time / DAY_LENGTH);
    const night = this.darkness > 0.5;
    if (this.started && night !== wasNight) {
      this.toast(night ? 'Наступает ночь — твари злее, добыча богаче' : 'Рассвет. Ночные твари редеют', night ? 'night' : 'day');
    }
    this.started = true;
  }

  // ---------------------------------------------------------------- player

  updatePlayer(dt) {
    const p = this.player, inp = this.input, st = this.st, w = this.world;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.eatCd = Math.max(0, p.eatCd - dt);
    p.cool = Math.max(0, p.cool - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.plantHint = Math.max(0, p.plantHint - dt);
    p.buffs.rage = Math.max(0, p.buffs.rage - dt);
    p.buffs.frost = Math.max(0, p.buffs.frost - dt);
    p.aim = Math.atan2(inp.aimY - p.y, inp.aimX - p.x);

    let mx = inp.mx, my = inp.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    p.inLiquid = w.liquidAt(p.x, p.y);
    p.biome = w.biomeIdx(p.x, p.y);
    if (inp.dash && p.dashCd <= 0 && p.dashT <= 0) {
      if (ml > 0.1) { p.dashDx = inp.mx / ml; p.dashDy = inp.my / ml; } else { p.dashDx = Math.cos(p.aim); p.dashDy = Math.sin(p.aim); }
      p.dashT = DASH_TIME;
      p.dashCd = p.dashMax = st.dashCd;
      p.invuln = Math.max(p.invuln, DASH_TIME + 0.1);
      this.emit('dash', p.x, p.y);
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDx * DASH_SPEED; p.vy = p.dashDy * DASH_SPEED;
    } else {
      const sp = st.speed * (p.inLiquid ? 0.55 : 1), k = 1 - Math.exp(-dt * 16);
      p.vx += (mx * sp - p.vx) * k; p.vy += (my * sp - p.vy) * k;
    }
    p.x += (p.vx + p.kx) * dt; p.y += (p.vy + p.ky) * dt;
    const kd = Math.exp(-dt * 9);
    p.kx *= kd; p.ky *= kd;
    pushE = p;
    w.nodesNear(p.x, p.y, p.r, pushOut);

    // Lava burns, the beacon heals.
    if (p.inLiquid && p.biome === 4) {
      p.burnT -= dt;
      if (p.burnT <= 0) { p.burnT = 0.5; this.hurtPlayer(6, p.x, p.y, true); if (!p.alive) return; }
    } else p.burnT = 0.15;
    p.atHome = p.x * p.x + p.y * p.y < HOME_RADIUS * HOME_RADIUS;
    const heal = st.regen + (p.atHome ? 8 : 0);
    if (heal > 0 && p.hp < st.maxHp) p.hp = Math.min(st.maxHp, p.hp + heal * dt);

    // Weapons.
    if (inp.weapon >= 0 && inp.weapon < WEAPONS.length && this.unlocked[WEAPONS[inp.weapon].id]) this.setWeapon(inp.weapon);
    if (inp.wheel) {
      let i = p.weapon;
      for (let k = 0; k < WEAPONS.length; k++) {
        i = (i + inp.wheel + WEAPONS.length) % WEAPONS.length;
        if (this.unlocked[WEAPONS[i].id]) break;
      }
      this.setWeapon(i);
    }
    if (inp.fire && p.cool <= 0) this.fire();

    // Farming and items.
    if (inp.cycleSeed) {
      let i = CROP_IDS.indexOf(p.seedSel);
      for (let k = 0; k < CROP_IDS.length; k++) {
        i = (i + 1) % CROP_IDS.length;
        if (this.inv[CROPS[CROP_IDS[i]].seed] > 0) break;
      }
      p.seedSel = CROP_IDS[i];
      p.plantHint = 3;
    }
    if (inp.plant) this.plant();
    if (inp.interact) this.interact();
    if (inp.eat) this.eat(inp.eat);
    this.spot = p.plantHint > 0 ? this.plantSpot() : null;

    // Hold to return to the beacon.
    if (inp.recall && this.boss) {
      if (!this.recallWarned) { this.recallWarned = true; this.toast('Хранитель не отпускает — возврат невозможен'); }
    } else if (inp.recall && !p.atHome) {
      p.recall += dt;
      if (p.recall >= RECALL_TIME) {
        p.recall = 0;
        this.emit('recall', p.x, p.y);
        p.x = 0; p.y = 70; p.vx = p.vy = p.kx = p.ky = 0;
        this.ebullets.length = 0; this.hazards.length = 0;
        this.emit('recall', p.x, p.y);
      }
    } else {
      p.recall = 0;
      if (!inp.recall) this.recallWarned = false;
    }
  }

  setWeapon(i) {
    const p = this.player;
    if (i === p.weapon) return;
    p.weapon = i;
    p.cool = Math.max(p.cool, 0.12);
    this.emit('swap', p.x, p.y);
  }

  fire() {
    const p = this.player, w = WEAPONS[p.weapon], st = this.st, rng = this.rng;
    p.cool = 1 / (w.rate * st.rateMul);
    const n = w.count || 1, ox = Math.cos(p.aim) * 12, oy = Math.sin(p.aim) * 12;
    for (let i = 0; i < n; i++) {
      const a = p.aim + (n > 1 ? (i / (n - 1) - 0.5) * w.arc : 0) + (rng() - 0.5) * (w.spread || 0);
      const sp = w.speed * (n > 1 ? 0.9 + rng() * 0.2 : 1);
      this.bullets.push({
        x: p.x + ox, y: p.y + oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: w.r, dmg: w.dmg * st.dmgMul, life: w.life,
        w: p.weapon, pierce: !!w.pierce, explode: w.explode || 0, homing: w.homing || 0, hit: w.pierce ? [] : null, color: w.color,
      });
    }
    this.emit('shoot', p.x, p.y, { weapon: w.id, a: p.aim, color: w.color });
  }

  hurtPlayer(dmg, sx, sy, soft) {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return false;
    if (p.buffs.frost > 0) dmg *= 0.6;
    p.hp -= dmg;
    p.hurtT = 0.3;
    p.invuln = soft ? 0.1 : 0.5;
    p.recall = 0;
    if (!soft) {
      const dx = p.x - sx, dy = p.y - sy, d = Math.hypot(dx, dy) || 1;
      p.kx += (dx / d) * 220; p.ky += (dy / d) * 220;
    }
    this.emit('hurt', p.x, p.y, { n: dmg });
    if (p.hp <= 0) this.killPlayer();
    return true;
  }

  killPlayer() {
    const p = this.player;
    p.hp = 0; p.alive = false; p.dashT = 0; p.vx = p.vy = 0;
    const lost = Math.floor(this.inv.essence * 0.25);
    this.inv.essence -= lost;
    this.stats.deaths++;
    if (this.boss) this.despawnBoss();
    this.emit('death', p.x, p.y, { lost });
  }

  respawn() {
    const p = this.player;
    p.x = 0; p.y = 70; p.vx = p.vy = p.kx = p.ky = 0;
    p.hp = this.derived().maxHp;
    p.alive = true; p.invuln = 2; p.recall = 0;
    p.buffs.rage = p.buffs.frost = 0;
    this.mobs.length = 0; this.bullets.length = 0; this.ebullets.length = 0; this.hazards.length = 0;
    this.emit('respawn', p.x, p.y);
  }

  // ---------------------------------------------------------------- farming

  cropProgress(c) { return clamp((this.time - c.t0) / c.dur, 0, 1); }

  // The tile in front of the player and whether a seed may go there.
  plantSpot() {
    const p = this.player, w = this.world;
    const tx = Math.floor((p.x + Math.cos(p.aim) * 44) / TILE), ty = Math.floor((p.y + Math.sin(p.aim) * 44) / TILE);
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    let ok = !this.crops.has(tx + ',' + ty) && !w.liquidAt(x, y) && x * x + y * y > 100 * 100;
    if (ok) for (const l of w.lairs) if (dist2(x, y, l.x, l.y) < 150 * 150) ok = false;
    if (ok) w.nodesNear(x, y, 20, () => { ok = false; });
    return { tx, ty, x, y, ok };
  }

  plant() {
    const p = this.player;
    p.plantHint = 3;
    let type = p.seedSel;
    if (!(this.inv[CROPS[type].seed] > 0)) {
      type = CROP_IDS.find((id) => this.inv[CROPS[id].seed] > 0);
      if (!type) { this.toast('Нет семян — ищи кусты и побеждай тварей'); return false; }
      p.seedSel = type;
    }
    const s = this.plantSpot();
    if (!s.ok) { this.toast('Здесь не посадить'); return false; }
    const def = CROPS[type], biome = BIOME_IDS[this.world.biomeIdx(s.x, s.y)];
    const dur = def.grow * (def.likes.includes(biome) ? 0.6 : 1) * (0.9 + this.rng() * 0.2);
    this.crops.set(s.tx + ',' + s.ty, { type, tx: s.tx, ty: s.ty, x: s.x, y: s.y, t0: this.time, dur });
    this.inv[def.seed]--;
    this.emit('plant', s.x, s.y, { crop: type });
    return true;
  }

  harvest(c) {
    const def = CROPS[c.type], rng = this.rng;
    this.crops.delete(c.tx + ',' + c.ty);
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) this.drop(def.item, 1, c.x, c.y);
    this.drop(def.seed, 1 + (rng() < 0.4 ? 1 : 0), c.x, c.y);
    this.stats.harvested++;
    this.emit('harvest', c.x, c.y, { crop: c.type });
  }

  // E: gather every ripe crop in reach, otherwise wake the guardian of a nearby lair.
  interact() {
    const p = this.player;
    let got = 0;
    for (const c of [...this.crops.values()]) {
      if (dist2(p.x, p.y, c.x, c.y) < 80 * 80 && this.cropProgress(c) >= 1) { this.harvest(c); got++; }
    }
    if (got || this.boss) return;
    for (const l of this.world.lairs) if (dist2(p.x, p.y, l.x, l.y) < 130 * 130) { this.summonBoss(l); return; }
  }

  eat(kind) {
    const p = this.player;
    if (p.eatCd > 0 || !(this.inv[kind] > 0)) return false;
    if (kind === 'berry') {
      if (p.hp >= this.st.maxHp - 0.5) return false;
      p.hp = Math.min(this.st.maxHp, p.hp + 40);
    } else if (kind === 'pepper') p.buffs.rage = 30;
    else if (kind === 'frost') p.buffs.frost = 30;
    else return false;
    this.inv[kind]--;
    p.eatCd = 0.35;
    this.emit('eat', p.x, p.y, { kind });
    return true;
  }

  updatePrompt() {
    const p = this.player;
    this.prompt = null;
    if (!p.alive) return;
    for (const c of this.crops.values()) {
      if (dist2(p.x, p.y, c.x, c.y) < 80 * 80 && this.cropProgress(c) >= 1) { this.prompt = { key: 'E', text: 'собрать урожай' }; return; }
    }
    if (!this.boss) {
      for (const l of this.world.lairs) {
        if (dist2(p.x, p.y, l.x, l.y) >= 130 * 130) continue;
        const lvl = this.bossKills[l.id] || 0;
        this.prompt = { key: 'E', text: `пробудить Хранителя: ${BOSSES[l.id].name}${lvl ? ` (сила ×${lvl + 1})` : ''}` };
        return;
      }
    }
    if (p.recall > 0) this.prompt = { key: 'T', text: 'возврат к Маяку…', progress: p.recall / RECALL_TIME };
  }

  // ---------------------------------------------------------------- projectiles

  nearestEnemy(x, y, range) {
    let best = range * range, target = null;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const d = dist2(x, y, m.x, m.y);
      if (d < best) { best = d; target = m; }
    }
    const b = this.boss;
    if (b && bossParts(b).length && dist2(x, y, b.x, b.y) < best) target = b;
    return target;
  }

  updateBullets(dt) {
    const bs = this.bullets, mobs = this.mobs, w = this.world;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.life -= dt;
      if (b.homing) {
        const t = this.nearestEnemy(b.x, b.y, 460);
        if (t) {
          const cur = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
          const a = cur + clamp(angDiff(cur, Math.atan2(t.y - b.y, t.x - b.x)), -b.homing * dt, b.homing * dt);
          b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
        }
      }
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      let dead = b.life <= 0;
      for (let j = 0; j < mobs.length && !dead; j++) {
        const m = mobs[j];
        if (m.dead || !segCircle(b.x, b.y, nx, ny, m.x, m.y, m.r + b.r)) continue;
        if (b.hit) { if (b.hit.includes(m)) continue; b.hit.push(m); }
        if (!b.explode) this.damageMob(m, b.dmg, b.vx, b.vy);
        this.emit('hit', nx, ny, { color: b.color });
        if (!b.pierce) dead = true;
      }
      const boss = this.boss;
      if (!dead && boss) {
        const parts = bossParts(boss);
        for (let j = 0; j < parts.length; j++) {
          const pt = parts[j];
          if (!segCircle(b.x, b.y, nx, ny, pt.x, pt.y, pt.r + b.r)) continue;
          if (b.hit) { if (b.hit.includes(boss)) break; b.hit.push(boss); }
          if (!b.explode) damageBoss(this, boss, b.dmg, pt.mul);
          this.emit('hit', nx, ny, { color: b.color });
          if (!b.pierce) dead = true;
          break;
        }
      }
      if (!dead) {
        const n = w.nodeHit(b.x, b.y, nx, ny, b.r, false);
        if (n && !(b.hit && b.hit.includes(n))) {
          if (b.hit) b.hit.push(n);
          if (!b.explode) this.damageNode(n, b.dmg);
          if (!b.pierce) dead = true;
        }
      }
      b.x = nx; b.y = ny;
      if (dead) {
        if (b.explode) this.explode(b.x, b.y, b.explode, b.dmg, b.color);
        bs[i] = bs[bs.length - 1];
        bs.pop();
      }
    }
  }

  explode(x, y, radius, dmg, color) {
    this.emit('boom', x, y, { r: radius, color });
    for (const m of this.mobs) {
      if (m.dead) continue;
      const rr = radius + m.r, d = dist2(x, y, m.x, m.y);
      if (d < rr * rr) this.damageMob(m, dmg * (d < rr * rr * 0.3 ? 1 : 0.65), m.x - x, m.y - y);
    }
    const b = this.boss;
    if (b) for (const pt of bossParts(b)) if (dist2(x, y, pt.x, pt.y) < (radius + pt.r) ** 2) { damageBoss(this, b, dmg, pt.mul); break; }
    this.world.nodesNear(x, y, radius, (n) => this.damageNode(n, dmg));
  }

  eshoot(x, y, a, speed, dmg, o) {
    if (this.ebullets.length > 700) return;
    this.ebullets.push({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: o.r || 6, dmg, life: o.life || 4,
      color: o.color || '#ff5d8f', homing: o.homing || 0, age: 0,
    });
  }

  updateEnemyBullets(dt) {
    const bs = this.ebullets, p = this.player, w = this.world;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.life -= dt; b.age += dt;
      if (b.homing && p.alive) {
        const cur = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
        const a = cur + clamp(angDiff(cur, Math.atan2(p.y - b.y, p.x - b.x)), -b.homing * dt, b.homing * dt);
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
      }
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      let dead = b.life <= 0;
      if (!dead && p.alive && segCircle(b.x, b.y, nx, ny, p.x, p.y, p.r * 0.8 + b.r) && this.hurtPlayer(b.dmg, b.x, b.y)) dead = true;
      // Trees and rocks give cover, and the beacon's field shatters anything hostile.
      if (!dead && (nx * nx + ny * ny < HOME_RADIUS * HOME_RADIUS || w.nodeHit(b.x, b.y, nx, ny, b.r * 0.5, true))) {
        dead = true;
        this.emit('spark', nx, ny, { color: b.color });
      }
      b.x = nx; b.y = ny;
      if (dead) { bs[i] = bs[bs.length - 1]; bs.pop(); }
    }
  }

  addHazard(x, y, r, delay, dmg, color) { this.hazards.push({ x, y, r, delay, dmg, color, t: 0 }); }

  updateHazards(dt) {
    const hs = this.hazards, p = this.player;
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i];
      h.t += dt;
      if (h.t < h.delay) continue;
      hs[i] = hs[hs.length - 1];
      hs.pop();
      this.emit('boom', h.x, h.y, { r: h.r, color: h.color, hostile: true });
      if (p.alive && dist2(p.x, p.y, h.x, h.y) < (h.r + p.r * 0.4) ** 2) this.hurtPlayer(h.dmg, h.x, h.y);
    }
  }

  // ---------------------------------------------------------------- nodes and loot

  damageNode(n, dmg) {
    n.hp -= dmg;
    n.hitAt = this.time;
    if (n.hp > 0) { this.emit('nodeHit', n.x, n.y, { color: n.def.color }); return; }
    n.hp = n.def.hp;
    n.deadUntil = this.time + n.def.respawn;
    for (const [item, lo, hi] of n.def.drops) {
      let c = lo + Math.floor(this.rng() * (hi - lo + 1));
      while (c > 0) { const k = c > 4 ? 2 : 1; this.drop(item, k, n.x, n.y); c -= k; }
    }
    this.emit('nodeBreak', n.x, n.y, { color: n.def.color, r: n.r });
  }

  drop(kind, n, x, y, power = 1) {
    if (this.pickups.length > 350) this.pickups.shift();
    const a = this.rng() * TAU, s = (70 + this.rng() * 150) * power;
    this.pickups.push({ kind, n, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 90 });
  }

  updatePickups(dt) {
    const p = this.player, ps = this.pickups, mag = this.st.magnet, fr = Math.exp(-dt * 5);
    for (let i = ps.length - 1; i >= 0; i--) {
      const k = ps[i];
      k.t += dt; k.life -= dt;
      k.x += k.vx * dt; k.y += k.vy * dt;
      k.vx *= fr; k.vy *= fr;
      let gone = k.life <= 0;
      if (!gone && p.alive && k.t > 0.3) {
        const dx = p.x - k.x, dy = p.y - k.y, d2 = dx * dx + dy * dy;
        if (d2 < 26 * 26) { this.collect(k); gone = true; }
        else if (d2 < mag * mag) {
          const d = Math.sqrt(d2), sp = 260 + (1 - d / mag) * 420;
          k.vx = (dx / d) * sp; k.vy = (dy / d) * sp;
        }
      }
      if (gone) { ps[i] = ps[ps.length - 1]; ps.pop(); }
    }
  }

  collect(k) {
    if (k.kind === 'heart') this.player.hp = Math.min(this.st.maxHp, this.player.hp + 18);
    else this.inv[k.kind] = (this.inv[k.kind] || 0) + k.n;
    this.emit('pickup', k.x, k.y, { kind: k.kind, n: k.n });
  }

  // ---------------------------------------------------------------- mobs

  spawnMob(type, x, y, o = {}) {
    const def = MOBS[type], rng = this.rng;
    // Creatures grow tougher the further they live from the beacon.
    const sc = 1 + Math.min(2.5, Math.max(0, Math.hypot(x, y) - 2500) / 6000);
    const elite = !!o.elite, hp = def.hp * sc * (elite ? 3.2 : 1);
    const m = {
      type, def, x, y, vx: 0, vy: 0, kx: 0, ky: 0, r: def.r * (elite ? 1.35 : 1), hp, maxHp: hp,
      dmg: def.dmg * (1 + (sc - 1) * 0.5) * (elite ? 1.4 : 1), ess: def.ess * sc * (elite ? 3 : 1) * (o.minion ? 0.4 : 1),
      elite, minion: !!o.minion, state: '', t: rng() * 0.6, cd: (def.fireEvery || 2) * rng(), hitT: 0, angry: 0,
      anim: rng() * 10, age: 0, seed: rng() * 100, side: rng() < 0.5 ? -1 : 1, face: rng() * TAU,
      dx: 1, dy: 0, wt: 0, wa: 0, wm: 0, ang: rng() * TAU, acc: 0, slow: false, dead: false,
    };
    this.mobs.push(m);
    return m;
  }

  damageMob(m, dmg, kx, ky) {
    if (m.dead || m.age < 0.12) return;
    m.hp -= dmg;
    m.hitT = 0.12;
    m.angry = 5;
    const l = Math.hypot(kx, ky) || 1, kb = clamp(dmg * 9, 40, 220) * (m.def.kb ?? 1) * (m.elite ? 0.5 : 1);
    m.kx = clamp(m.kx + (kx / l) * kb, -300, 300);
    m.ky = clamp(m.ky + (ky / l) * kb, -300, 300);
    this.emit('dmg', m.x, m.y - m.r, { n: dmg });
    if (m.hp <= 0) this.killMob(m);
  }

  killMob(m) {
    const rng = this.rng, def = m.def, boost = m.elite ? 3 : 1;
    m.dead = true;
    this.stats.kills++;
    const ess = Math.max(1, Math.round(m.ess)), orbs = ess <= 3 ? 1 : ess <= 12 ? 2 : 3, part = Math.floor(ess / orbs);
    for (let i = 0; i < orbs; i++) this.drop('essence', i ? part : ess - part * (orbs - 1), m.x, m.y);
    if (rng() < 0.045 * boost) this.drop('heart', 1, m.x, m.y);
    const crop = CROPS[BIOMES[BIOME_IDS[this.world.biomeIdx(m.x, m.y)]].crop];
    if (rng() < 0.07 * boost) this.drop(crop.seed, 1, m.x, m.y);
    if (def.drops) for (const [item, chance] of def.drops) if (rng() < chance * boost) this.drop(item, 1 + (rng() < 0.3 ? 1 : 0), m.x, m.y);
    if (m.elite) this.drop('crystal', 2, m.x, m.y);
    if (def.split) for (let i = 0; i < 2; i++) this.spawnMob(def.split, m.x + (i ? 12 : -12), m.y + (rng() - 0.5) * 16, { minion: m.minion });
    this.emit('kill', m.x, m.y, { color: def.color, r: m.r, elite: m.elite });
  }

  updateMobs(dt) {
    const p = this.player, mobs = this.mobs, rng = this.rng, w = this.world;
    const kv = 1 - Math.exp(-dt * 8), kd = Math.exp(-dt * 7);
    for (let i = mobs.length - 1; i >= 0; i--) {
      const m = mobs[i];
      let dx = p.x - m.x, dy = p.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      if (m.dead || d > DESPAWN) { mobs[i] = mobs[mobs.length - 1]; mobs.pop(); continue; }
      dx /= d; dy /= d;
      m.hitT = Math.max(0, m.hitT - dt);
      m.angry = Math.max(0, m.angry - dt);
      m.anim += dt; m.age += dt;
      const def = m.def, sp = def.speed * (m.slow ? 0.6 : 1);
      // The beacon hides the player; only creatures that were just hit keep hunting.
      const aggro = p.alive && d < AGGRO && (!p.atHome || m.angry > 0 || m.minion);
      let vx = 0, vy = 0, direct = false, roam = false;
      switch (def.ai) {
        case 'chaser': roam = true; break;
        case 'hopper':
          m.t -= dt;
          if (m.state === 'hop') {
            vx = m.dx * sp * 2.1; vy = m.dy * sp * 2.1;
            if (m.t <= 0) { m.state = ''; m.t = 0.3 + rng() * 0.5; }
          } else if (m.t <= 0) {
            const a = aggro ? Math.atan2(dy, dx) + (rng() - 0.5) * 0.6 : rng() * TAU;
            m.dx = Math.cos(a); m.dy = Math.sin(a); m.state = 'hop'; m.t = 0.36;
          }
          break;
        case 'swooper':
          if (!aggro) { roam = true; break; }
          if (m.t > 0) { m.t -= dt; vx = -dx * sp; vy = -dy * sp; } else {
            const s = Math.sin(m.anim * 6 + m.seed) * 0.9;
            vx = (dx - dy * s) * sp; vy = (dy + dx * s) * sp;
          }
          break;
        case 'shooter':
          if (!aggro) { roam = true; m.state = ''; break; }
          if (m.state === 'aim') {
            m.t -= dt;
            if (m.t <= 0) {
              const s = def.shot, a = Math.atan2(dy, dx);
              for (let k = 0; k < s.n; k++) this.eshoot(m.x, m.y, a + (k - (s.n - 1) / 2) * s.spread, s.speed, m.dmg, s);
              m.state = ''; m.cd = def.fireEvery * (0.85 + rng() * 0.3);
              this.emit('mobShot', m.x, m.y);
            }
          } else {
            const f = d > def.range ? 1 : d < def.range * 0.55 ? -1 : 0;
            vx = (dx * f - dy * m.side * 0.45) * sp; vy = (dy * f + dx * m.side * 0.45) * sp;
            m.cd -= dt;
            if (m.cd <= 0 && d < def.range * 1.35) { m.state = 'aim'; m.t = 0.42; }
          }
          break;
        case 'charger':
          if (m.state === 'windup') {
            m.t -= dt;
            if (m.t <= 0) { m.state = 'dash'; m.t = 0.48; }
          } else if (m.state === 'dash') {
            m.t -= dt; vx = m.dx * 620; vy = m.dy * 620; direct = true;
            if (m.t <= 0) { m.state = 'rest'; m.t = 0.7; }
          } else if (m.state === 'rest') {
            m.t -= dt;
            if (m.t <= 0) m.state = '';
          } else if (aggro && d < 330 && d > 70) { m.state = 'windup'; m.t = 0.5; m.dx = dx; m.dy = dy; } else roam = true;
          break;
        case 'bomber':
          if (m.state === 'fuse') {
            m.t -= dt; vx = dx * sp * 0.3; vy = dy * sp * 0.3;
            if (m.t <= 0) {
              this.addHazard(m.x, m.y, 92, 0, m.dmg, '#ff8c2a');
              m.dead = true;
              this.emit('kill', m.x, m.y, { color: def.color, r: m.r });
            }
          } else {
            roam = true;
            if (aggro && d < 80) { m.state = 'fuse'; m.t = 0.55; }
          }
          break;
        case 'orbiter': {
          if (!aggro) { roam = true; break; }
          const f = clamp((d - 250) / 110, -1, 1);
          vx = (dx * f - dy * m.side * 0.85) * sp; vy = (dy * f + dx * m.side * 0.85) * sp;
          m.cd -= dt;
          if (m.cd <= 0 && d < 420) {
            m.cd = def.fireEvery * (0.8 + rng() * 0.4);
            this.eshoot(m.x, m.y, Math.atan2(dy, dx), 215, m.dmg, WISP_SHOT);
            this.emit('mobShot', m.x, m.y);
          }
          break;
        }
        case 'tank':
          if (m.state === 'slam') {
            m.t -= dt;
            if (m.t <= 0) {
              m.state = ''; m.cd = 3.4;
              const off = rng() * TAU;
              for (let k = 0; k < 12; k++) this.eshoot(m.x, m.y, off + (k / 12) * TAU, 230, m.dmg * 0.6, YETI_SHOT);
            }
          } else {
            roam = true;
            m.cd -= dt;
            if (aggro && m.cd <= 0 && d < 180) { m.state = 'slam'; m.t = 0.7; roam = false; this.addHazard(m.x, m.y, 125, 0.7, m.dmg, '#4a7aff'); }
          }
          break;
        case 'turret':
          if (!aggro) { roam = true; m.state = ''; break; }
          if (d > 330) { vx = dx * sp; vy = dy * sp; }
          if (m.state === 'fire') {
            m.t -= dt; m.acc += dt;
            while (m.acc >= 0.15) {
              m.acc -= 0.15; m.ang += 0.5;
              this.eshoot(m.x, m.y, m.ang, 200, m.dmg, SENT_SHOT);
              this.eshoot(m.x, m.y, m.ang + Math.PI, 200, m.dmg, SENT_SHOT);
            }
            if (m.t <= 0) { m.state = ''; m.cd = 2.2; }
          } else {
            m.cd -= dt;
            if (m.cd <= 0 && d < 440) { m.state = 'fire'; m.t = 1.8; m.acc = 0; }
          }
          break;
      }
      if (roam) {
        if (aggro) { vx = dx * sp; vy = dy * sp; } else {
          m.wt -= dt;
          if (m.wt <= 0) { m.wt = 1.2 + rng() * 2.4; m.wa = rng() * TAU; m.wm = rng() < 0.65 ? 0.35 : 0; }
          vx = Math.cos(m.wa) * sp * m.wm; vy = Math.sin(m.wa) * sp * m.wm;
        }
      }
      if (direct) { m.vx = vx; m.vy = vy; } else { m.vx += (vx - m.vx) * kv; m.vy += (vy - m.vy) * kv; }
      m.x += (m.vx + m.kx) * dt; m.y += (m.vy + m.ky) * dt;
      m.kx *= kd; m.ky *= kd;
      // The beacon's field pushes creatures out of the safe zone.
      const hd = Math.hypot(m.x, m.y);
      if (hd < HOME_RADIUS + 20 && hd > 1) { m.x += (m.x / hd) * 320 * dt; m.y += (m.y / hd) * 320 * dt; }
      if (!def.flying) {
        pushE = m;
        w.nodesNear(m.x, m.y, m.r, pushOut);
        m.slow = w.liquidAt(m.x, m.y);
      }
      if (m.state === 'windup') m.face = Math.atan2(m.dy, m.dx);
      else if (m.vx * m.vx + m.vy * m.vy > 200) m.face = Math.atan2(m.vy, m.vx);
      else if (aggro) m.face = Math.atan2(dy, dx);
      if (p.alive && d < m.r + p.r - 3 && this.hurtPlayer(m.dmg * (m.state === 'dash' ? 1.4 : 1), m.x, m.y) && def.ai === 'swooper') m.t = 0.55;
    }
    // Keep the pack from stacking into one blob.
    for (let i = 0; i < mobs.length; i++) {
      const a = mobs[i];
      for (let j = i + 1; j < mobs.length; j++) {
        const b = mobs[j], dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 0.01) continue;
        const d = Math.sqrt(d2), o = ((rr - d) * 0.5) / d;
        a.x -= dx * o; a.y -= dy * o; b.x += dx * o; b.y += dy * o;
      }
    }
  }

  updateSpawner(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const night = this.darkness > 0.5, p = this.player, rng = this.rng, w = this.world;
    this.spawnT = night ? 0.45 : 0.8;
    if (!p.alive) return;
    let count = 0;
    for (const m of this.mobs) if (!m.minion) count++;
    const cap = this.boss ? 3 : (night ? 18 : 11) + p.biome * 2;
    if (count >= cap) return;
    // Spawn out of sight, never inside the safe zone or a dormant arena.
    const a = rng() * TAU, r = 880 + rng() * 220;
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (x * x + y * y < (HOME_RADIUS + 280) ** 2) return;
    for (const l of w.lairs) if (dist2(x, y, l.x, l.y) < l.r * l.r) return;
    const type = pick(BIOME_MOBS[BIOME_IDS[w.biomeIdx(x, y)]], rng());
    const def = MOBS[type];
    if (!def.flying && w.liquidAt(x, y)) return;
    const n = def.pack ? 1 + Math.floor(rng() * def.pack) : 1;
    for (let k = 0; k < n; k++) {
      this.spawnMob(type, x + (rng() - 0.5) * 90 * k, y + (rng() - 0.5) * 90 * k, { elite: k === 0 && rng() < (night ? 0.16 : 0.05) });
    }
  }

  // ---------------------------------------------------------------- guardians

  summonBoss(lair) {
    if (this.boss) return false;
    this.boss = spawnBoss(this, lair);
    this.emit('bossStart', lair.x, lair.y, { name: this.boss.name, title: this.boss.def.title, color: this.boss.def.color });
    return true;
  }

  despawnBoss() {
    if (!this.boss) return;
    this.boss = null;
    this.ebullets.length = 0; this.hazards.length = 0;
    for (const m of this.mobs) if (m.minion) m.dead = true;
    this.emit('bossGone', 0, 0);
  }

  // ---------------------------------------------------------------- workshop

  upgradeCost(id) {
    const d = UPGRADES.find((u) => u.id === id);
    return this.upg[id] >= d.max ? Infinity : Math.round(d.base * Math.pow(d.grow, this.upg[id]));
  }

  buyUpgrade(id) {
    const cost = this.upgradeCost(id);
    if (!(this.inv.essence >= cost)) return false;
    this.inv.essence -= cost;
    this.upg[id]++;
    if (id === 'hp') this.player.hp += 20;
    this.st = this.derived();
    this.emit('upgrade', this.player.x, this.player.y);
    return true;
  }

  canCraft(id) {
    const w = WEAPONS.find((x) => x.id === id);
    if (!w || !w.cost || this.unlocked[id] || (w.core && !this.cores[w.core])) return false;
    for (const k in w.cost) if (!(this.inv[k] >= w.cost[k])) return false;
    return true;
  }

  craft(id) {
    if (!this.canCraft(id)) return false;
    const i = WEAPONS.findIndex((x) => x.id === id);
    for (const k in WEAPONS[i].cost) this.inv[k] -= WEAPONS[i].cost[k];
    this.unlocked[id] = true;
    this.player.weapon = i;
    this.emit('craft', this.player.x, this.player.y);
    return true;
  }

  // ---------------------------------------------------------------- persistence

  serialize() {
    const p = this.player;
    return {
      v: 1, seed: this.seed, time: this.time,
      player: { x: p.x, y: p.y, hp: p.hp, weapon: p.weapon, seedSel: p.seedSel },
      inv: { ...this.inv }, upg: { ...this.upg }, unlocked: { ...this.unlocked }, cores: { ...this.cores },
      bossKills: { ...this.bossKills }, stats: { ...this.stats }, won: this.won,
      crops: [...this.crops.values()].map((c) => [c.tx, c.ty, c.type, c.t0, c.dur]),
    };
  }

  applySave(s) {
    const p = this.player;
    this.time = s.time;
    Object.assign(this.inv, s.inv);
    Object.assign(this.upg, s.upg);
    Object.assign(this.unlocked, s.unlocked);
    Object.assign(this.cores, s.cores);
    Object.assign(this.bossKills, s.bossKills);
    Object.assign(this.stats, s.stats);
    this.won = !!s.won;
    p.invuln = 2;
    p.weapon = WEAPONS[s.player.weapon] && this.unlocked[WEAPONS[s.player.weapon].id] ? s.player.weapon : 0;
    if (CROPS[s.player.seedSel]) p.seedSel = s.player.seedSel;
    // A save taken at the moment of death resumes at the beacon.
    if (s.player.hp > 0) { p.x = s.player.x; p.y = s.player.y; p.hp = s.player.hp; }
    for (const [tx, ty, type, t0, dur] of s.crops) {
      if (CROPS[type]) this.crops.set(tx + ',' + ty, { type, tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, t0, dur });
    }
  }
}
