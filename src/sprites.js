// Procedural "stained glass" art: every shape is a mosaic of flat facets held by dark lead lines.
import { TAU, mulberry32 } from './util.js';
import { BOSSES, NODES, WEAPONS } from './config.js';
import { LASER_LEN, LASER_W } from './bosses.js';

export const LEAD = '#0d0b18';

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// Mix a hex colour with white (f > 0) or black (f < 0).
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), to = f < 0 ? 0 : 255, k = Math.abs(f);
  const c = (v) => Math.round(v + (to - v) * k);
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// ------------------------------------------------------------------ facet primitives

export function poly(g, pts, fill, lw = 2) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (lw) { g.lineWidth = lw; g.strokeStyle = LEAD; g.stroke(); }
}

export function dot(g, x, y, r, fill, lw = 1.5) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (lw) { g.lineWidth = lw; g.strokeStyle = LEAD; g.stroke(); }
}

function ringPts(cx, cy, n, rad, rot = 0) {
  const pts = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU, r = typeof rad === 'number' ? rad : rad(i);
    pts[i * 2] = cx + Math.cos(a) * r;
    pts[i * 2 + 1] = cy + Math.sin(a) * r;
  }
  return pts;
}

// Outline cut into triangles around a hub point, cycling through the palette.
export function gem(g, pts, hx, hy, cols, lw = 2) {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    poly(g, [hx, hy, pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]], cols[i % cols.length], lw);
  }
}

// Faceted disc or star: rad is a radius or a function of the vertex index.
export function fan(g, cx, cy, n, rad, rot, cols, lw = 2) {
  gem(g, ringPts(cx, cy, n, rad, rot), cx, cy, cols, lw);
}

// Shard growing from (x,y) along angle a, split lengthwise into a light and a dark facet.
export function kite(g, x, y, a, len, wd, c1, c2, lw = 2, waist = 0.4) {
  const cx = Math.cos(a), cy = Math.sin(a), tx = x + cx * len, ty = y + cy * len;
  const mx = x + cx * len * waist, my = y + cy * len * waist;
  poly(g, [x, y, mx - cy * wd, my + cx * wd, tx, ty], c1, lw);
  poly(g, [x, y, mx + cy * wd, my - cx * wd, tx, ty], c2, lw);
}

// Shard centred on (x,y); len and wd are half extents.
export function diamond(g, x, y, a, len, wd, c1, c2, lw = 2) {
  const cx = Math.cos(a) * len, cy = Math.sin(a) * len, px = -Math.sin(a) * wd, py = Math.cos(a) * wd;
  poly(g, [x - cx, y - cy, x + px, y + py, x + cx, y + cy], c1, lw);
  poly(g, [x - cx, y - cy, x - px, y - py, x + cx, y + cy], c2, lw);
}

function eye(g, x, y, s, face) {
  dot(g, x, y, s, '#ffffff', 1.2);
  dot(g, x + Math.cos(face) * s * 0.35, y + Math.sin(face) * s * 0.35, s * 0.52, LEAD, 0);
}

// ------------------------------------------------------------------ cached sprites

const glows = new Map();

// Soft radial glow in the given hex colour, used for additive halos and for night lights.
export function glowSprite(color) {
  let c = glows.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(color, 1));
    gr.addColorStop(0.3, rgba(color, 0.5));
    gr.addColorStop(0.65, rgba(color, 0.14));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    glows.set(color, c);
  }
  return c;
}

const sprites = new Map();
let spriteRes = 2;

export function setSpriteRes(res) {
  if (res === spriteRes) return;
  spriteRes = res;
  sprites.clear();
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Static art is drawn once into an offscreen canvas centred on (half, half).
function sprite(key, half, draw) {
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(half * 2 * spriteRes);
    c.half = half;
    const g = c.getContext('2d');
    g.scale(spriteRes, spriteRes);
    g.translate(half, half);
    g.lineJoin = 'round';
    draw(g, mulberry32(hashStr(key)));
    sprites.set(key, c);
  }
  return c;
}

export function drawSprite(g, c, x, y, rot = 0, scale = 1) {
  const h = c.half * scale;
  if (rot) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.drawImage(c, -h, -h, h * 2, h * 2);
    g.restore();
  } else g.drawImage(c, x - h, y - h, h * 2, h * 2);
}

// ------------------------------------------------------------------ resource nodes

function radii(n, f) {
  const rs = [];
  for (let i = 0; i < n; i++) rs.push(f(i));
  return rs;
}

function shardCluster(g, R, rnd, cols, n, width = 0.2) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd() * 0.5;
    kite(g, 0, 0, a, R * (0.65 + rnd() * 0.38), R * (width * 0.8 + rnd() * width * 0.4), cols[0], cols[1], 1.8, 0.45);
  }
  fan(g, 0, 0, 6, R * 0.2, rnd() * TAU, [cols[2], cols[0]], 1.5);
}

function conifer(g, R, rnd, outer, mid, inner) {
  const rot = rnd() * TAU;
  fan(g, 0, 0, 16, (i) => R * (i % 2 ? 0.58 : 1), rot, outer);
  fan(g, 0, 0, 12, (i) => R * (i % 2 ? 0.36 : 0.66), rot + 0.3, mid);
  fan(g, 0, 0, 8, (i) => R * (i % 2 ? 0.16 : 0.34), rot + 0.6, inner, 1.5);
}

function shrub(g, R, rnd, cols, berry) {
  const rs = radii(7, () => R * (0.8 + rnd() * 0.25));
  fan(g, 0, 0, 7, (i) => rs[i], rnd() * TAU, cols);
  for (let i = 0; i < 3; i++) {
    const a = rnd() * TAU, d = R * (0.3 + rnd() * 0.3);
    dot(g, Math.cos(a) * d, Math.sin(a) * d, 3.2, berry, 1.2);
  }
}

function boulder(g, R, rnd, cols, fleck) {
  const rs = radii(7, () => R * (0.75 + rnd() * 0.3));
  const hx = (rnd() - 0.5) * R * 0.4, hy = (rnd() - 0.5) * R * 0.4;
  gem(g, ringPts(0, 0, 7, (i) => rs[i], rnd() * TAU), hx, hy, cols);
  for (let i = 0; i < 2; i++) {
    const x = (rnd() - 0.5) * R * 0.9, y = (rnd() - 0.5) * R * 0.9;
    poly(g, [x, y, x + 5, y + 2, x + 1, y + 6], fleck, 1);
  }
}

const NODE_ART = {
  tree(g, R, rnd) {
    const rs = radii(9, (i) => R * (i % 2 ? 1 : 0.8) * (0.92 + rnd() * 0.12));
    fan(g, 0, 0, 9, (i) => rs[i], rnd() * TAU, ['#1f8a5a', '#2fae6e', '#17704a']);
    fan(g, 0, 0, 6, R * 0.5, rnd() * TAU, ['#b6f08a', '#8fe07a', '#d4f8a4'], 1.5);
    fan(g, 0, 0, 6, R * 0.16, 0, ['#8a5a36', '#6e4527'], 1.5);
  },
  pine: (g, R, rnd) => conifer(g, R, rnd, ['#14604f', '#1b7a62'], ['#229277', '#2aa888'], ['#49c9a0', '#6fe0b8']),
  snowpine: (g, R, rnd) => conifer(g, R, rnd, ['#4f9ab8', '#3f84a2'], ['#ffffff', '#dff4ff'], ['#9fd8f0', '#c8ecf8']),
  bush: (g, R, rnd) => shrub(g, R, rnd, ['#8fd35a', '#6dbb48', '#a9e36e'], '#8ef5ff'),
  frostbush: (g, R, rnd) => shrub(g, R, rnd, ['#c9d8ff', '#aabdf2', '#e3ecff'], '#b48cff'),
  rock: (g, R, rnd) => boulder(g, R, rnd, ['#9aa0b8', '#7c829c', '#b9bfd6', '#666b85', '#a7adc6'], '#ffd27a'),
  obsidian: (g, R, rnd) => boulder(g, R, rnd, ['#3a2a52', '#553a78', '#2a1d3d', '#6f4d9a', '#442f63'], '#ff7ae0'),
  crystal: (g, R, rnd) => shardCluster(g, R, rnd, ['#8ef5ff', '#35bfe0', '#eaffff'], 5),
  ice: (g, R, rnd) => shardCluster(g, R, rnd, ['#e8fbff', '#9fd8f0', '#ffffff'], 6),
  magma: (g, R, rnd) => shardCluster(g, R, rnd, ['#ffc24a', '#ff6a2a', '#fff0a0'], 5),
  deadtree: (g, R, rnd) => shardCluster(g, R, rnd, ['#c8b8a4', '#8a7a6a', '#e0d4c4'], 6, 0.1),
  cactus(g, R, rnd) {
    fan(g, 0, 0, 12, (i) => R * (i % 2 ? 0.72 : 1), rnd() * TAU, ['#5fbf6a', '#3f9c58']);
    fan(g, 0, 0, 5, R * 0.3, 0, ['#ff8fc8', '#ffb3da'], 1.5);
  },
  bloom(g, R, rnd) {
    fan(g, 0, 0, 16, (i) => R * (i % 2 ? 0.45 : 1), rnd() * TAU, ['#e0304a', '#ff5a6a']);
    fan(g, 0, 0, 6, R * 0.3, 0, ['#ffe27a', '#fff2b0'], 1.5);
  },
};

export function nodeSprite(n) {
  const R = NODES[n.type].vr;
  return sprite(`node:${n.type}:${n.variant}`, R * 1.15 + 4, (g, rnd) => NODE_ART[n.type](g, R, rnd));
}

export const stumpSprite = () => sprite('stump', 12, (g) => fan(g, 0, 0, 6, 7, 0.3, ['#3a3040', '#2a2230'], 1.5));

// ------------------------------------------------------------------ crops, icons, landmarks

const LEAVES = { berry: ['#58c063', '#8fe07a'], pepper: ['#4fa64f', '#7fc95a'], frost: ['#7fb8c9', '#a9dcea'] };

// stage 0..3, where 3 is ripe and carries fruit
export function cropSprite(type, stage) {
  return sprite(`crop:${type}:${stage}`, 26, (g) => {
    fan(g, 0, 0, 6, 20, 0.26, ['#5b3a26', '#4a2e1e', '#6a452d'], 1.5);
    const n = 3 + stage, R = 6 + stage * 3.4;
    fan(g, 0, 0, n * 2, (i) => R * (i % 2 ? 0.42 : 1), 0.5, LEAVES[type], 1.5);
    if (stage < 3) return;
    for (let i = 0; i < 3; i++) {
      const a = i * (TAU / 3) + 0.3, x = Math.cos(a) * 8.5, y = Math.sin(a) * 8.5;
      if (type === 'berry') { dot(g, x, y, 4.4, '#8ef5ff', 1.4); dot(g, x - 1.2, y - 1.4, 1.3, '#ffffff', 0); }
      else if (type === 'pepper') kite(g, x * 0.5, y * 0.5, a, 11, 3.6, '#ff8a4a', '#e0401a', 1.4);
      else fan(g, x, y, 8, (k) => (k % 2 ? 2 : 5.4), a, ['#ffffff', '#c9b5ff'], 1.2);
    }
  });
}

function seedArt(g, s, color) {
  poly(g, [0, -0.46 * s, 0.3 * s, 0.08 * s, 0.16 * s, 0.42 * s, -0.16 * s, 0.42 * s, -0.3 * s, 0.08 * s], '#ecd6a4', 1.5);
  poly(g, [0, -0.2 * s, 0.13 * s, 0.1 * s, 0, 0.3 * s, -0.13 * s, 0.1 * s], color, 1);
}

const ICON_ART = {
  essence(g, s) {
    fan(g, 0, 0, 8, (i) => s * (i % 2 ? 0.2 : 0.5), -Math.PI / 2, ['#d9b8ff', '#9a6be0'], 1.5);
    dot(g, 0, 0, s * 0.1, '#ffffff', 0);
  },
  wood(g, s) {
    poly(g, [-0.46 * s, -0.04 * s, 0.3 * s, -0.42 * s, 0.46 * s, -0.2 * s, -0.3 * s, 0.18 * s], '#d19a5b', 1.5);
    poly(g, [-0.4 * s, 0.3 * s, 0.34 * s, -0.04 * s, 0.47 * s, 0.18 * s, -0.27 * s, 0.5 * s], '#a87440', 1.5);
  },
  ore(g, s) {
    gem(g, ringPts(0, 0, 6, s * 0.47, 0.3), -s * 0.08, -s * 0.08, ['#c3cae0', '#8e95b0', '#e3e8f5', '#767c96'], 1.5);
    poly(g, [-s * 0.05, s * 0.02, s * 0.18, s * 0.08, s * 0.04, s * 0.24], '#ffd27a', 1);
  },
  crystal(g, s) {
    gem(g, [0, -0.5 * s, 0.3 * s, -0.06 * s, 0, 0.5 * s, -0.3 * s, -0.06 * s], 0, -0.08 * s, ['#8ef5ff', '#35bfe0', '#6fe0f5', '#eaffff'], 1.5);
  },
  seedBerry: (g, s) => seedArt(g, s, '#35bfe0'),
  seedPepper: (g, s) => seedArt(g, s, '#ff6a3a'),
  seedFrost: (g, s) => seedArt(g, s, '#a98cff'),
  berry(g, s) {
    poly(g, [-0.05 * s, -0.5 * s, 0.25 * s, -0.36 * s, 0.02 * s, -0.2 * s], '#58c063', 1.2);
    for (const [x, y] of [[-0.2, -0.05], [0.2, -0.02], [0, 0.26]]) {
      dot(g, x * s, y * s, s * 0.2, '#8ef5ff', 1.4);
      dot(g, (x - 0.06) * s, (y - 0.07) * s, s * 0.06, '#ffffff', 0);
    }
  },
  pepper(g, s) {
    poly(g, [-0.44 * s, -0.1 * s, -0.1 * s, -0.34 * s, 0.3 * s, -0.14 * s, 0.47 * s, 0.32 * s, 0.1 * s, 0.14 * s, -0.2 * s, 0.14 * s], '#ff6a3a', 1.5);
    poly(g, [-0.1 * s, -0.34 * s, 0.3 * s, -0.14 * s, 0.1 * s, 0.14 * s], '#ff9a5a', 0);
    poly(g, [-0.5 * s, -0.3 * s, -0.28 * s, -0.36 * s, -0.34 * s, -0.08 * s], '#58c063', 1.2);
  },
  frost(g, s) { fan(g, 0, 0, 12, (i) => s * (i % 2 ? 0.2 : 0.5), -Math.PI / 2, ['#f0eaff', '#c9b5ff'], 1.5); },
  heart(g, s) {
    gem(g, [0, 0.46 * s, -0.47 * s, -0.04 * s, -0.3 * s, -0.42 * s, 0, -0.2 * s, 0.3 * s, -0.42 * s, 0.47 * s, -0.04 * s], 0, 0.02 * s,
      ['#e03a5a', '#ff5d7a', '#ff8ba0', '#ff7089', '#ff5d7a', '#c82a4a'], 1.5);
  },
};

export function iconSprite(kind) {
  return sprite(`icon:${kind}`, 15, (g) => {
    if (kind.startsWith('core:')) {
      const def = BOSSES[kind.slice(5)];
      fan(g, 0, 0, 6, 12.5, 0.52, [def.color, shade(def.color, -0.35), shade(def.color, 0.35)], 1.5);
      fan(g, 0, 0, 6, 5.5, 0, ['#ffffff', def.color2], 1.2);
    } else if (kind.startsWith('weapon:')) weaponArt(g, kind.slice(7));
    else ICON_ART[kind](g, 24);
  });
}

function weaponArt(g, id) {
  const c = WEAPONS.find((w) => w.id === id).color, d = shade(c, -0.35);
  if (id === 'shard') diamond(g, 0, 0, -0.7, 12, 4.6, c, d);
  else if (id === 'fan') for (let i = -1; i <= 1; i++) kite(g, 0, 10, -Math.PI / 2 + i * 0.52, 20, 3.4, c, d, 1.5);
  else if (id === 'needle') for (let i = -1; i <= 1; i++) diamond(g, i * 6, -i * 2.5, -1.05, 11, 1.9, c, d, 1.2);
  else if (id === 'prism') {
    poly(g, [0, -11, 11, 8, -11, 8], c, 1.6);
    poly(g, [0, -11, 0, 8, -11, 8], d, 1.6);
    poly(g, [-12, 3, 12, -4, 12, -1, -12, 6], '#ffffff', 1);
  } else if (id === 'comet') {
    kite(g, 4, -4, 2.36, 16, 5, d, shade(c, -0.55), 1.5, 0.3);
    fan(g, 4, -4, 6, 7.5, 0, [c, shade(c, 0.4)], 1.5);
  } else {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * (TAU / 3);
      diamond(g, Math.cos(a) * 6.5, Math.sin(a) * 6.5, a, 5.6, 3.2, c, d, 1.5);
    }
  }
}

export function altarSprite(id) {
  return sprite(`altar:${id}`, 100, (g) => {
    const def = BOSSES[id];
    for (let i = 0; i < 8; i++) {
      const a = i * (TAU / 8) + TAU / 16;
      diamond(g, Math.cos(a) * 80, Math.sin(a) * 80, a, 16, 7, '#565070', '#34304a');
    }
    fan(g, 0, 0, 16, (i) => (i % 2 ? 52 : 64), 0, ['#2e2a40', '#3d3856']);
    fan(g, 0, 0, 8, 42, TAU / 16, [def.color, shade(def.color, -0.4)]);
    fan(g, 0, 0, 8, (i) => (i % 2 ? 12 : 25), 0, [def.color2, '#ffffff'], 1.5);
  });
}

// The home beacon is a rose window laid into the ground.
export function beaconSprite() {
  return sprite('beacon', 106, (g) => {
    fan(g, 0, 0, 16, (i) => (i % 2 ? 92 : 101), 0, ['#243a8f', '#3a2a7a', '#1f5a8a', '#4a2f8f']);
    fan(g, 0, 0, 12, (i) => (i % 2 ? 62 : 73), TAU / 24, ['#ffd27a', '#e0a03c', '#fff0b0']);
    fan(g, 0, 0, 8, 45, 0, ['#6ff0ff', '#35bfe0', '#eaffff', '#8fb4ff']);
    fan(g, 0, 0, 8, (i) => (i % 2 ? 12 : 25), TAU / 16, ['#ffffff', '#ffe9a8'], 1.5);
  });
}

// ------------------------------------------------------------------ player

// Drawn at the origin; the caller translates to the player's position.
export function drawPlayer(g, p, t, weaponColor) {
  const sp = Math.hypot(p.vx, p.vy);
  const back = sp > 20 ? Math.atan2(-p.vy, -p.vx) : p.aim + Math.PI;
  const len = 15 + Math.min(14, sp * 0.04) + (p.dashT > 0 ? 12 : 0);
  kite(g, Math.cos(back) * 3, Math.sin(back) * 3, back + Math.sin(t * 9) * 0.22, len, 9, '#2f6bff', '#1b3fae', 2, 0.3);
  g.rotate(p.aim);
  poly(g, [4, 5, 27, 3.5, 32, 6.5, 27, 9.5, 4, 10], weaponColor);
  poly(g, [5, -12, 15, -8, 8, -3], '#ffd27a', 1.5);
  gem(g, [-13, 0, -6, -11, 7, -10, 13, 0, 7, 10, -6, 11], 0, 0, ['#3f7bff', '#6fa0ff', '#2f6bff', '#1f49c9', '#16389e', '#2a58e0']);
  fan(g, 1, 0, 6, 6.5, 0, ['#fff2c8', '#ffd98a']);
  poly(g, [3, -3, 8.5, 0, 3, 3], '#6ff0ff', 1.2);
}

// ------------------------------------------------------------------ creatures

function legs(g, r, sx, sy, reach, lw) {
  g.lineWidth = lw;
  g.strokeStyle = LEAD;
  g.beginPath();
  for (let i = -1; i <= 1; i++) {
    g.moveTo(i * r * sx, -r * sy); g.lineTo(i * r * (sx + 0.12), -r * reach);
    g.moveTo(i * r * sx, r * sy); g.lineTo(i * r * (sx + 0.12), r * reach);
  }
  g.stroke();
}

// Each function draws around the origin for a creature of nominal radius r.
export const MOB_ART = {
  slime(g, m, r) {
    const hop = m.state === 'hop', w = Math.sin(m.anim * (hop ? 17 : 5)) * (hop ? 0.14 : 0.05);
    g.scale(1 + w, 1 - w);
    fan(g, 0, 0, 8, (i) => r * (i % 2 ? 0.96 : 1.06), 0.2, ['#ff7aa8', '#e0528a', '#ffa8c8', '#c03a70']);
    fan(g, -r * 0.22, -r * 0.26, 5, r * 0.28, 0.4, ['#ffe0ec', '#ffc8dc'], 1);
    const ex = Math.cos(m.face) * r * 0.34, ey = Math.sin(m.face) * r * 0.34;
    const px = -Math.sin(m.face) * r * 0.3, py = Math.cos(m.face) * r * 0.3;
    eye(g, ex + px, ey + py, 3.4, m.face);
    eye(g, ex - px, ey - py, 3.4, m.face);
  },
  wasp(g, m, r) {
    g.rotate(m.face);
    const flap = Math.sin(m.anim * 45) * 0.45, alpha = g.globalAlpha;
    g.globalAlpha = alpha * 0.75;
    poly(g, [0, -r * 0.2, -r * 0.5, -r * (1.25 + flap * 0.4), -r * 1.2, -r * (0.7 + flap * 0.5)], '#d4f3ff', 1.2);
    poly(g, [0, r * 0.2, -r * 0.5, r * (1.25 + flap * 0.4), -r * 1.2, r * (0.7 + flap * 0.5)], '#d4f3ff', 1.2);
    g.globalAlpha = alpha;
    poly(g, [-r * 1.5, 0, -r * 0.9, -r * 0.3, -r * 0.9, r * 0.3], '#2a1d10', 1.5);
    poly(g, [-r * 1.0, 0, -r * 0.3, -r * 0.62, r * 0.25, 0], '#ffd23a');
    poly(g, [-r * 1.0, 0, -r * 0.3, r * 0.62, r * 0.25, 0], '#e09a1a');
    poly(g, [-r * 0.72, -r * 0.25, -r * 0.5, -r * 0.44, -r * 0.5, r * 0.44, -r * 0.72, r * 0.25], '#2a1d10', 0);
    fan(g, r * 0.5, 0, 6, r * 0.42, 0, ['#ffb52a', '#ffe07a']);
    dot(g, r * 0.72, -r * 0.18, 1.8, '#ff4a5a', 0);
    dot(g, r * 0.72, r * 0.18, 1.8, '#ff4a5a', 0);
  },
  spore(g, m, r) {
    const aim = m.state === 'aim' ? 1 - m.t / 0.42 : 0, k = 1 + Math.sin(m.anim * 3) * 0.04 + aim * 0.16;
    fan(g, 0, 0, 9, (i) => r * k * (i % 2 ? 0.94 : 1.08), m.seed, ['#c26bff', '#9a45e0', '#d98cff']);
    for (let i = 0; i < 4; i++) {
      const a = m.seed + i * (TAU / 4) + 0.4;
      dot(g, Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.14, '#ffe6ff', 1);
    }
    fan(g, 0, 0, 6, r * (0.32 + aim * 0.12), -m.seed, aim > 0 ? ['#ffffff', '#ffd0ff'] : ['#ffd0ff', '#f0a6ff'], 1.5);
  },
  wolf(g, m, r) {
    g.rotate(m.face);
    const tail = Math.sin(m.anim * 9) * r * 0.3;
    poly(g, [-r * 1.0, -r * 0.22, -r * 1.85, tail, -r * 1.0, r * 0.22], '#7474c0');
    gem(g, [-r * 1.15, 0, -r * 0.5, -r * 0.72, r * 0.5, -r * 0.6, r * 0.9, 0, r * 0.5, r * 0.6, -r * 0.5, r * 0.72], 0, 0,
      ['#9a9ae0', '#b6b6f0', '#8585d0', '#6a6ab8', '#5c5ca8', '#7474c0']);
    poly(g, [r * 0.5, -r * 0.34, r * 0.95, -r * 0.62, r * 0.45, -r * 0.9], '#5c5ca8', 1.5);
    poly(g, [r * 0.5, r * 0.34, r * 0.95, r * 0.62, r * 0.45, r * 0.9], '#5c5ca8', 1.5);
    poly(g, [r * 0.55, -r * 0.46, r * 1.6, 0, r * 0.55, r * 0.46], m.state === 'windup' ? '#ffffff' : '#d4d4ff');
    dot(g, r * 0.95, -r * 0.2, 2.2, '#ff4a5a', 0);
    dot(g, r * 0.95, r * 0.2, 2.2, '#ff4a5a', 0);
  },
  scorp(g, m, r) {
    g.rotate(m.face);
    const wag = Math.sin(m.anim * 5) * r * 0.22;
    legs(g, r, 0.45, 0.4, 1.05, 2.5);
    fan(g, -r * 1.05, wag * 0.4, 6, r * 0.36, 0, ['#6a2040', '#8a2f52']);
    fan(g, -r * 1.55, wag * 0.8, 6, r * 0.3, 0, ['#6a2040', '#8a2f52']);
    poly(g, [-r * 1.75, wag - r * 0.2, -r * 2.3, wag * 1.3, -r * 1.75, wag + r * 0.2], m.state === 'aim' ? '#ffffff' : '#c86aff');
    poly(g, [r * 0.6, -r * 0.3, r * 1.25, -r * 0.85, r * 1.75, -r * 0.5, r * 1.3, -r * 0.4], '#ffd27a');
    poly(g, [r * 0.6, r * 0.3, r * 1.25, r * 0.85, r * 1.75, r * 0.5, r * 1.3, r * 0.4], '#ffd27a');
    fan(g, -r * 0.5, 0, 6, r * 0.55, 0.5, ['#8a2f52', '#6a2040', '#a84068']);
    fan(g, r * 0.3, 0, 6, r * 0.62, 0, ['#a84068', '#8a2f52', '#6a2040']);
    dot(g, r * 0.7, -r * 0.2, 2, '#fff2b0', 0);
    dot(g, r * 0.7, r * 0.2, 2, '#fff2b0', 0);
  },
  beetle(g, m, r) {
    g.rotate(m.face);
    const lit = m.state === 'fuse' && Math.sin(m.anim * 40) > 0;
    legs(g, r, 0.5, 0.5, 1.15, 2.2);
    fan(g, r * 0.95, 0, 6, r * 0.4, 0, ['#12303a', '#1f4a58']);
    poly(g, [-r * 1.05, 0, -r * 0.6, -r * 0.85, r * 0.45, -r * 0.8, r * 0.85, 0], lit ? '#fff2b0' : '#2fa8b8');
    poly(g, [-r * 1.05, 0, -r * 0.6, r * 0.85, r * 0.45, r * 0.8, r * 0.85, 0], lit ? '#ffe07a' : '#1f8898');
    poly(g, [-r * 0.4, -r * 0.5, r * 0.3, -r * 0.46, r * 0.1, -r * 0.14], lit ? '#ffffff' : '#7fe0ea', 1);
    poly(g, [-r * 0.9, 0, r * 0.8, -r * 0.08, r * 0.8, r * 0.08], '#ffb03a', 0);
  },
  wisp(g, m, r) {
    const bob = Math.sin(m.anim * 3) * 2;
    for (let i = 0; i < 3; i++) {
      const a = m.anim * 2.2 + i * (TAU / 3);
      diamond(g, Math.cos(a) * r * 1.5, bob + Math.sin(a) * r * 1.5, a + 1.2, r * 0.38, r * 0.16, '#d6d0ff', '#8a7aff', 1.2);
    }
    gem(g, [0, -r * 1.2 + bob, r * 0.62, bob, 0, r * 1.2 + bob, -r * 0.62, bob], 0, bob - r * 0.15, ['#8a7aff', '#3a2ab0', '#5a4ae0', '#b0a6ff']);
    dot(g, -r * 0.18, bob - r * 0.1, 2, '#ffffff', 0);
    dot(g, r * 0.18, bob - r * 0.1, 2, '#ffffff', 0);
  },
  yeti(g, m, r) {
    g.rotate(m.face);
    const slam = m.state === 'slam' ? 1 - m.t / 0.7 : 0, sw = Math.sin(m.anim * 4) * r * 0.08;
    const fx = r * (0.55 + slam * 0.35), fs = r * (0.42 + slam * 0.2);
    fan(g, fx + sw, -r * 0.95, 6, fs, 0.3, ['#34507c', '#263f66', '#4a6a9a']);
    fan(g, fx - sw, r * 0.95, 6, fs, 0.3, ['#34507c', '#263f66', '#4a6a9a']);
    fan(g, 0, 0, 8, (i) => r * (i % 2 ? 0.95 : 1.05), 0.2, ['#4a6a9a', '#34507c', '#6a8abc', '#263f66']);
    poly(g, [r * 0.35, -r * 0.34, r * 1.05, -r * 0.7, r * 0.6, -r * 0.1], '#f4fbff');
    poly(g, [r * 0.35, r * 0.34, r * 1.05, r * 0.7, r * 0.6, r * 0.1], '#f4fbff');
    fan(g, r * 0.3, 0, 6, r * 0.42, 0, ['#263f66', '#1c3052']);
    dot(g, r * 0.5, -r * 0.14, 2.4, '#6ff0ff', 0);
    dot(g, r * 0.5, r * 0.14, 2.4, '#6ff0ff', 0);
  },
  magmite(g, m, r) {
    const rnd = mulberry32((m.seed * 1000) | 0), rs = radii(7, () => r * (0.85 + rnd() * 0.3));
    const pts = ringPts(0, 0, 7, (i) => rs[i], m.seed), hx = r * 0.1, hy = -r * 0.1;
    gem(g, pts, hx, hy, ['#ff8a2a', '#ffb03a', '#e0601a', '#ffd24a']);
    g.strokeStyle = rgba('#5a1a10', 0.6 + 0.4 * Math.sin(m.anim * 6));
    g.lineWidth = 2.5;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const k = (i * 2 + 1) % 7;
      g.moveTo(hx, hy);
      g.lineTo(pts[k * 2] * 0.8, pts[k * 2 + 1] * 0.8);
    }
    g.stroke();
    const ex = Math.cos(m.face), ey = Math.sin(m.face);
    dot(g, ex * r * 0.4 - ey * r * 0.25, ey * r * 0.4 + ex * r * 0.25, 2.8, '#ffffff', 1.2);
    dot(g, ex * r * 0.4 + ey * r * 0.25, ey * r * 0.4 - ex * r * 0.25, 2.8, '#ffffff', 1.2);
  },
  sentinel(g, m, r) {
    const firing = m.state === 'fire', rot = m.anim * (firing ? 4 : 1.2);
    for (let i = 0; i < 4; i++) kite(g, 0, 0, rot + i * (TAU / 4), r * 1.6, r * 0.3, '#b8b0a8', '#8a827a');
    fan(g, 0, 0, 8, r, 0.39, ['#e8e0d8', '#c8c0b8']);
    fan(g, 0, 0, 8, r * 0.55, 0, firing ? ['#ffe04a', '#ff8a3a'] : ['#ff4a4a', '#c8323a'], 1.5);
    dot(g, Math.cos(m.face) * r * 0.15, Math.sin(m.face) * r * 0.15, r * 0.18, '#fff0c0', 1);
  },
};
MOB_ART.magmiteS = MOB_ART.magmite;

// ------------------------------------------------------------------ guardians

// Drawn around the origin (the caller translates to the boss); look is the angle towards the player.
export const BOSS_ART = {
  forest(g, b, t, look) {
    const r = b.r, p2 = b.phase >= 2, open = 0.5 + 0.5 * Math.sin(t * (p2 ? 3 : 1.6));
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? '#2c7a48' : LEAD;
      g.lineWidth = pass ? 5 : 9;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * (TAU / 8) + 0.2, w = Math.sin(t * 2 + i) * 0.25;
        g.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
        g.quadraticCurveTo(Math.cos(a + w) * r * 1.4, Math.sin(a + w) * r * 1.4, Math.cos(a - w) * r * 2, Math.sin(a - w) * r * 2);
      }
      g.stroke();
    }
    g.lineCap = 'butt';
    const pc = p2 ? ['#ff4a8a', '#c8205a'] : ['#ff6ad5', '#c94aa8'];
    for (let i = 0; i < 10; i++) {
      const a = b.ang + i * (TAU / 10);
      kite(g, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, a, r * (0.75 + open * 0.25), r * 0.26, pc[0], pc[1], 2, 0.45);
    }
    fan(g, 0, 0, 10, r * 0.82, -b.ang * 0.5, ['#3f9c58', '#58c063', '#2c7a48']);
    fan(g, 0, 0, 8, r * 0.44, b.ang, ['#ffd0f0', '#ff9ae0']);
    dot(g, 0, 0, r * 0.2, '#fff8e0', 2);
    dot(g, Math.cos(look) * r * 0.08, Math.sin(look) * r * 0.08, r * 0.1, LEAD, 0);
  },
  desert(g, b) {
    const r = b.r;
    for (let i = b.segs.length - 1; i >= 0; i--) {
      const s = b.segs[i], prev = i ? b.segs[i - 1] : b, a = Math.atan2(prev.y - s.y, prev.x - s.x);
      const x = s.x - b.x, y = s.y - b.y;
      fan(g, x, y, 6, s.r, a, ['#6a48b0', '#4f3390', '#8a66d0']);
      diamond(g, x, y, a, s.r * 0.55, s.r * 0.28, '#ffd27a', '#e0a03c', 1.5);
    }
    g.rotate(b.face);
    poly(g, [r * 0.45, -r * 0.55, r * 1.55, -r * 0.42, r * 0.95, -r * 0.05], '#fff0c0');
    poly(g, [r * 0.45, r * 0.55, r * 1.55, r * 0.42, r * 0.95, r * 0.05], '#fff0c0');
    fan(g, 0, 0, 8, (i) => r * (i % 2 ? 0.95 : 1.08), 0, ['#8a66d0', '#6a48b0', '#4f3390', '#a888e8']);
    diamond(g, -r * 0.1, 0, 0, r * 0.6, r * 0.3, '#ffd27a', '#e0a03c');
    dot(g, r * 0.55, -r * 0.35, 3.5, '#ff3a3a', 1.2);
    dot(g, r * 0.55, r * 0.35, 3.5, '#ff3a3a', 1.2);
  },
  tundra(g, b, t) {
    const r = b.r, stomp = b.state === 'stomp' ? 1 - b.st / 0.8 : 0, sw = Math.sin(t * 2.2) * r * 0.06;
    g.rotate(b.face);
    for (const s of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        kite(g, -r * 0.1 + i * r * 0.28, s * r * 0.8, s * (Math.PI / 2) + i * 0.35, r * (0.75 - Math.abs(i) * 0.15), r * 0.16, '#eaffff', '#9fd8f0', 1.5);
      }
      fan(g, r * (0.72 + stomp * 0.3) + s * sw, s * r * 0.82, 6, r * (0.4 + stomp * 0.14), 0.3, ['#2a4888', '#1f3870', '#3a5fa8']);
    }
    fan(g, 0, 0, 10, (i) => r * (i % 2 ? 0.96 : 1.04), 0.16, ['#3a5fa8', '#2a4888', '#5a80c8', '#1f3870']);
    diamond(g, -r * 0.2, 0, 0, r * 0.42, r * 0.3, '#ffffff', '#6ff0ff');
    fan(g, r * 0.42, 0, 6, r * 0.36, 0, ['#1f3870', '#16285a']);
    dot(g, r * 0.6, -r * 0.13, 3, '#6ff0ff', 0);
    dot(g, r * 0.6, r * 0.13, 3, '#6ff0ff', 0);
  },
  volcano(g, b, t) {
    const r = b.r, beat = 1 + Math.sin(t * (3 + b.phase * 1.5)) * 0.05;
    for (let i = 0; i < 12; i++) {
      const a = b.ang + i * (TAU / 12);
      diamond(g, Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5, a + Math.PI / 2, r * 0.3, r * 0.14, '#5a2a30', '#3a2028', 1.5);
    }
    for (let i = 0; i < 8; i++) {
      const a = -b.ang * 1.4 + i * (TAU / 8);
      diamond(g, Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12, a, r * 0.26, r * 0.14, '#a83a28', '#7a2a24', 1.5);
    }
    fan(g, 0, 0, 9, (i) => r * beat * (i % 2 ? 0.7 : 0.84), t * 0.2, ['#ff5a2a', '#ff8a3a', '#e03a1a']);
    fan(g, 0, 0, 6, r * 0.36 * beat, -t * 0.4, ['#fff0a0', '#ffd24a'], 1.5);
  },
};

// Attack telegraphs and beams, drawn in world space above the night shading.
export function drawBossFx(g, b) {
  if (b.id === 'volcano' && (b.state === 'lcharge' || b.state === 'laser')) {
    const firing = b.state === 'laser';
    g.lineCap = 'round';
    for (let i = 0; i < b.nl; i++) {
      const a = b.la + (i / b.nl) * TAU, cx = Math.cos(a), cy = Math.sin(a);
      g.beginPath();
      g.moveTo(b.x + cx * b.r, b.y + cy * b.r);
      g.lineTo(b.x + cx * LASER_LEN, b.y + cy * LASER_LEN);
      if (firing) {
        g.lineWidth = LASER_W * 2.6; g.strokeStyle = rgba('#ff5a2a', 0.5); g.stroke();
        g.lineWidth = LASER_W * 1.3; g.strokeStyle = '#ffd24a'; g.stroke();
        g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
      } else {
        g.lineWidth = 3; g.strokeStyle = rgba('#ffd24a', 0.35 + 0.35 * Math.sin(b.t * 30)); g.stroke();
      }
    }
    g.lineCap = 'butt';
  } else if (b.id === 'desert' && b.state === 'aim') {
    const cx = Math.cos(b.ca), cy = Math.sin(b.ca), w = b.r, len = 660;
    g.beginPath();
    g.moveTo(b.x - cy * w, b.y + cx * w);
    g.lineTo(b.x + cx * len, b.y + cy * len);
    g.lineTo(b.x + cy * w, b.y - cx * w);
    g.closePath();
    g.fillStyle = rgba('#ff3a3a', 0.16 + 0.14 * Math.sin(b.t * 24));
    g.fill();
  }
}
