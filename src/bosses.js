// Guardians: one boss per lair, each with its own attack patterns and escalating phases.
import { BOSSES, ARENA_RADIUS } from './config.js';
import { TAU, clamp, dist2, angDiff } from './util.js';

export const LASER_LEN = 760;
export const LASER_W = 12;
const LEASH = 1350; // the fight resets when the player runs this far from the lair
const NONE = [];
const THORN = { r: 7, color: '#ff6ad5', life: 5 };
const LASH = { r: 6, color: '#b8ff5a', life: 3 };
const SPIT = { r: 7, color: '#c86aff', life: 3.5 };
const ICE = { r: 6, color: '#3a6aff', life: 4.5 };
const ORB = { r: 10, color: '#a04aff', life: 5, homing: 1.5 };
const EMBER = { r: 7, color: '#ff9a3a', life: 5 };

export function spawnBoss(game, lair) {
  const def = BOSSES[lair.id], lvl = game.bossKills[lair.id] || 0;
  const hp = Math.round(def.hp * (1 + 0.6 * lvl));
  const b = {
    id: lair.id, def, name: def.name, lair, lvl, x: lair.x, y: lair.y, r: def.r, mul: 1, hp, maxHp: hp, dmgMul: 1 + 0.25 * lvl,
    t: 0, phase: 1, state: 'intro', st: 1.6, seq: 0, c1: 1.2, c2: 6, c3: 3, acc: 0, ang: 0, face: 0, dir: 1, vx: 0, vy: 0,
    hitT: 0, hidden: false, dead: false, segs: null, parts: null, ca: 0, la: 0, lw: 0, nl: 0,
  };
  if (lair.id === 'desert') {
    b.segs = [];
    for (let i = 0; i < 11; i++) b.segs.push({ x: b.x, y: b.y + (i + 1) * 6, r: Math.max(13, 27 - i * 1.3), mul: 0.6 });
  }
  // Hit circles: the body itself plus, for the wyrm, its tail segments (reduced damage).
  b.parts = b.segs ? [b, ...b.segs] : [b];
  return b;
}

export const bossParts = (b) => (b.hidden || b.state === 'intro' ? NONE : b.parts);

export function damageBoss(game, b, dmg, mul = 1) {
  if (b.dead || b.hidden || b.state === 'intro') return;
  dmg *= mul;
  b.hp -= dmg;
  b.hitT = 0.1;
  game.emit('dmg', b.x, b.y - b.r, { n: dmg });
  if (b.hp <= 0) killBoss(game, b);
}

function killBoss(game, b) {
  const def = b.def, first = !game.cores[b.id], bonus = 1 + 0.5 * b.lvl;
  b.dead = true; b.hp = 0;
  game.cores[b.id] = true;
  game.bossKills[b.id] = (game.bossKills[b.id] || 0) + 1;
  game.boss = null;
  game.ebullets.length = 0; game.hazards.length = 0;
  for (const m of game.mobs) if (m.minion) m.dead = true;
  let ess = Math.round(def.essence * bonus);
  const chunk = Math.max(5, Math.round(ess / 14));
  while (ess > 0) { const v = Math.min(chunk, ess); game.drop('essence', v, b.x, b.y, 2.4); ess -= v; }
  for (const [item, n] of def.loot) {
    let left = Math.round(n * bonus);
    while (left > 0) { const v = Math.min(4, left); game.drop(item, v, b.x, b.y, 2.4); left -= v; }
  }
  for (let i = 0; i < 3; i++) game.drop('heart', 1, b.x, b.y, 2);
  game.emit('bossDead', b.x, b.y, { id: b.id, name: b.name, first, color: def.color, r: b.r });
  if (b.id === 'volcano' && !game.won) { game.won = true; game.emit('victory', b.x, b.y); }
}

function fire(game, b, a, speed, o) { game.eshoot(b.x, b.y, a, speed, b.def.shot * b.dmgMul, o); }

// Ring of n shots; gapN consecutive shots starting at gapAt are left out as a dodge lane.
function ring(game, b, n, speed, off, o, gapAt = 0, gapN = 0) {
  for (let i = 0; i < n; i++) {
    if (gapN && (i - gapAt + n) % n < gapN) continue;
    fire(game, b, off + (i / n) * TAU, speed, o);
  }
}

function minionCount(game) {
  let n = 0;
  for (const m of game.mobs) if (m.minion && !m.dead) n++;
  return n;
}

function summon(game, b, type, n, dist) {
  for (let i = 0; i < n; i++) {
    const a = game.rng() * TAU;
    game.spawnMob(type, b.x + Math.cos(a) * dist, b.y + Math.sin(a) * dist, { minion: true });
  }
}

function clampToArena(b) {
  const lx = b.x - b.lair.x, ly = b.y - b.lair.y, ld = Math.hypot(lx, ly), lim = ARENA_RADIUS - 30;
  if (ld > lim) { b.x = b.lair.x + (lx / ld) * lim; b.y = b.lair.y + (ly / ld) * lim; }
}

// Tail segments trail the head like beads on a string.
function follow(b) {
  let px = b.x, py = b.y, pr = b.r;
  for (const s of b.segs) {
    const dx = s.x - px, dy = s.y - py, d = Math.hypot(dx, dy) || 0.01, gap = (pr + s.r) * 0.62;
    s.x = px + (dx / d) * gap; s.y = py + (dy / d) * gap;
    px = s.x; py = s.y; pr = s.r;
  }
}

const AI = {
  // Thornmother: thorn rings, aimed lashes and summoned creatures.
  forest(game, b, dt, p, dx, dy, d) {
    const p2 = b.phase >= 2;
    if (d > 240) { b.x += (dx / d) * 48 * dt; b.y += (dy / d) * 48 * dt; }
    b.ang += dt * (p2 ? 0.9 : 0.5);
    b.c1 -= dt; b.c2 -= dt; b.c3 -= dt;
    if (b.c1 <= 0) {
      b.c1 = p2 ? 1.7 : 2.4;
      ring(game, b, p2 ? 18 : 14, 225, b.ang, THORN);
      game.emit('bossShot', b.x, b.y);
    }
    if (b.c3 <= 0) {
      b.c3 = p2 ? 2.6 : 4.4;
      const a = Math.atan2(dy, dx), n = p2 ? 5 : 3;
      for (let i = 0; i < n; i++) fire(game, b, a + (i - (n - 1) / 2) * 0.15, 400, LASH);
    }
    if (b.c2 <= 0) {
      b.c2 = p2 ? 8 : 11;
      if (minionCount(game) < 5) {
        summon(game, b, 'spore', 2, 90);
        if (p2) summon(game, b, 'wolf', 1, 90);
      }
    }
  },

  // Dune wyrm: circles and spits, charges in a straight line, later burrows under the player.
  desert(game, b, dt, p, dx, dy, d) {
    const p2 = b.phase >= 2, def = b.def, k = 1 - Math.exp(-dt * 4);
    b.st -= dt;
    switch (b.state) {
      case 'idle':
        b.state = 'circle'; b.st = 3; b.c1 = 0.7; b.dir = game.rng() < 0.5 ? 1 : -1;
        break;
      case 'circle': {
        const f = clamp((d - 330) / 150, -1, 1);
        const tx = (dx / d) * f - (dy / d) * b.dir * 0.9, ty = (dy / d) * f + (dx / d) * b.dir * 0.9;
        b.vx += (tx * 270 - b.vx) * k; b.vy += (ty * 270 - b.vy) * k;
        b.c1 -= dt;
        if (b.c1 <= 0) {
          b.c1 = p2 ? 0.8 : 1.15;
          const a = Math.atan2(dy, dx), n = p2 ? 5 : 3;
          for (let i = 0; i < n; i++) fire(game, b, a + (i - (n - 1) / 2) * 0.2, 300, SPIT);
        }
        if (b.st <= 0) { b.state = 'aim'; b.st = 0.75; }
        break;
      }
      case 'aim':
        b.vx *= 1 - k; b.vy *= 1 - k;
        if (b.st > 0.22) b.ca = Math.atan2(dy, dx); // the last moments are locked so the charge can be dodged
        if (b.st <= 0) { b.state = 'charge'; b.st = 0.85; game.emit('bossShot', b.x, b.y); }
        break;
      case 'charge':
        b.vx = Math.cos(b.ca) * 780; b.vy = Math.sin(b.ca) * 780;
        if (b.st > 0) break;
        if (p2 && b.seq++ % 2 === 0) {
          b.state = 'burrow'; b.st = 1; b.hidden = true; b.vx = b.vy = 0;
          game.emit('boom', b.x, b.y, { r: 70, color: def.color, hostile: true });
        } else { b.state = 'circle'; b.st = 2.8; b.dir = -b.dir; }
        break;
      case 'burrow':
        if (b.st > 0) break;
        b.state = 'emerge'; b.st = 0.9;
        b.x = p.x; b.y = p.y;
        clampToArena(b);
        game.addHazard(b.x, b.y, 135, 0.9, def.slam * b.dmgMul, def.color);
        break;
      case 'emerge':
        if (b.st > 0) break;
        b.hidden = false; b.state = 'circle'; b.st = 2.6;
        for (const s of b.segs) { s.x = b.x; s.y = b.y; }
        ring(game, b, 16, 240, game.rng() * TAU, SPIT);
        break;
    }
    if (b.hidden) return;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.state === 'aim') b.face += angDiff(b.face, b.ca) * Math.min(1, dt * 10);
    else if (b.vx * b.vx + b.vy * b.vy > 400) b.face = Math.atan2(b.vy, b.vx);
  },

  // Frost colossus: slow advance with spiral streams, mortar strikes and a stomp.
  tundra(game, b, dt, p, dx, dy, d) {
    const p2 = b.phase >= 2, def = b.def, rng = game.rng;
    if (d > 170 && b.state !== 'stomp') { b.x += (dx / d) * 58 * dt; b.y += (dy / d) * 58 * dt; }
    b.face += angDiff(b.face, Math.atan2(dy, dx)) * Math.min(1, dt * 3);
    b.st -= dt;
    switch (b.state) {
      case 'idle':
        if (b.st > 0) break;
        switch (b.seq++ % 4) {
          case 0:
            b.state = 'spiral'; b.st = 3.6; b.acc = 0; b.dir = -b.dir;
            break;
          case 2:
            b.state = 'stomp'; b.st = 0.8;
            game.addHazard(b.x, b.y, 170, 0.8, def.slam * b.dmgMul, def.color);
            break;
          default: {
            const n = p2 ? 8 : 5;
            for (let i = 0; i < n; i++) {
              const a = rng() * TAU, r = i === 0 ? 0 : 70 + rng() * 190;
              game.addHazard(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 78, 1 + i * 0.08, def.slam * b.dmgMul, def.color);
            }
            if (p2) for (let i = 0; i < 2; i++) fire(game, b, Math.atan2(dy, dx) + (i ? 0.6 : -0.6), 150, ORB);
            b.st = 1.5;
            game.emit('bossShot', b.x, b.y);
          }
        }
        break;
      case 'spiral': {
        const arms = p2 ? 3 : 2;
        b.acc += dt;
        while (b.acc >= 0.11) {
          b.acc -= 0.11; b.ang += 0.19 * b.dir;
          for (let i = 0; i < arms; i++) fire(game, b, b.ang + (i / arms) * TAU, 215, ICE);
        }
        if (b.st <= 0) { b.state = 'idle'; b.st = 1.1; }
        break;
      }
      case 'stomp':
        if (b.st > 0) break;
        ring(game, b, p2 ? 26 : 20, 260, rng() * TAU, ICE);
        b.state = 'idle'; b.st = 1.2;
        game.emit('bossShot', b.x, b.y);
        break;
    }
  },

  // Ashen heart: rooted in place; ember rings with a gap, sweeping beams and meteor rain.
  volcano(game, b, dt, p, dx, dy) {
    const ph = b.phase, def = b.def, rng = game.rng;
    b.st -= dt; b.c1 -= dt; b.c2 -= dt;
    b.ang += dt * 0.6;
    if (b.c1 <= 0) {
      b.c1 = ph >= 3 ? 1.9 : 2.7;
      ring(game, b, 22, 195, rng() * TAU, EMBER, Math.floor(rng() * 22), 4);
      game.emit('bossShot', b.x, b.y);
    }
    if (ph >= 3 && b.c2 <= 0) {
      b.c2 = 9;
      if (minionCount(game) < 4) summon(game, b, 'magmiteS', 2, 100);
    }
    switch (b.state) {
      case 'idle':
        if (b.st > 0) break;
        if (b.seq++ % 2 === 0) {
          b.state = 'lcharge'; b.st = 1.1; b.nl = ph + 1; b.la = rng() * TAU;
          b.lw = (rng() < 0.5 ? -1 : 1) * (0.4 + 0.09 * ph);
        } else { b.state = 'meteor'; b.st = 3.2; b.acc = 0; }
        break;
      case 'lcharge':
        if (b.st <= 0) { b.state = 'laser'; b.st = 4.4; game.emit('bossLaser', b.x, b.y); }
        break;
      case 'laser':
        b.la += b.lw * dt;
        for (let i = 0; i < b.nl; i++) {
          const a = b.la + (i / b.nl) * TAU, cx = Math.cos(a), cy = Math.sin(a);
          const t = clamp(dx * cx + dy * cy, b.r, LASER_LEN);
          const ox = dx - cx * t, oy = dy - cy * t;
          if (ox * ox + oy * oy < (LASER_W + p.r * 0.7) ** 2) { game.hurtPlayer(def.laser * b.dmgMul, b.x + cx * t, b.y + cy * t); break; }
        }
        if (b.st <= 0) { b.state = 'idle'; b.st = 1.1; }
        break;
      case 'meteor': {
        const every = ph >= 3 ? 0.2 : 0.3;
        b.acc += dt;
        while (b.acc >= every) {
          b.acc -= every;
          const a = rng() * TAU, r = rng() < 0.3 ? 0 : 60 + rng() * 260;
          game.addHazard(p.x + p.vx * 0.5 + Math.cos(a) * r, p.y + p.vy * 0.5 + Math.sin(a) * r, 84, 1, def.slam * b.dmgMul, def.color2);
        }
        if (b.st <= 0) { b.state = 'idle'; b.st = 1; }
        break;
      }
    }
  },
};

export function updateBoss(game, b, dt) {
  const p = game.player;
  b.t += dt;
  b.hitT = Math.max(0, b.hitT - dt);
  if (!p.alive || dist2(p.x, p.y, b.lair.x, b.lair.y) > LEASH * LEASH) {
    game.despawnBoss();
    game.toast(`${b.name} скрылся — возвращайся к алтарю`);
    return;
  }
  if (b.state === 'intro') {
    b.st -= dt;
    if (b.st <= 0) { b.state = 'idle'; b.st = 0.6; }
    return;
  }
  let phase = 1;
  for (const f of b.def.phases) if (b.hp / b.maxHp <= f) phase++;
  if (phase > b.phase) {
    b.phase = phase;
    ring(game, b, 16, 170, 0, { r: 8, color: b.def.color, life: 4 });
    game.emit('bossPhase', b.x, b.y, { name: b.name, phase, color: b.def.color });
  }
  const dx = p.x - b.x, dy = p.y - b.y;
  AI[b.id](game, b, dt, p, dx, dy, Math.hypot(dx, dy) || 1);
  if (game.boss !== b) return;
  clampToArena(b);
  if (b.segs) follow(b);
  if (b.hidden) return;
  for (const pt of b.parts) {
    if (dist2(p.x, p.y, pt.x, pt.y) >= (pt.r + p.r - 4) ** 2) continue;
    game.hurtPlayer(b.def.touch * b.dmgMul * (b.state === 'charge' ? 1.5 : 1), pt.x, pt.y);
    break;
  }
}
