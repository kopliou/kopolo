// Canvas renderer: cached terrain mosaics, sprites, particles and night lighting.
import { TILE, CHUNK_TILES, CHUNK, HOME_RADIUS, ARENA_RADIUS, RECALL_TIME, WEAPONS, ITEMS, BOSSES, CROPS } from './config.js';
import { TAU, clamp, lerp, hash01, hash2, fbm } from './util.js';
import * as S from './sprites.js';

const LEAD = S.LEAD;
const PAD = 16; // jittered tiles overhang their chunk by a few units
const VIEW_H = 680; // world units visible vertically
const VIEW_W = 1260; // ...but never more than this horizontally, so nothing spawns in sight
const ART_SCALE = 1.18; // creatures are drawn a little larger than their hit circles
const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

// Glass palettes per biome: hue, saturation and lightness ranges plus rare accent pieces [chance, h, s, l].
const PAL = [
  { h: [104, 126], s: [48, 58], l: [41, 48], acc: [[0.022, 58, 78, 58], [0.012, 330, 62, 68]] },
  { h: [152, 170], s: [42, 54], l: [24, 31], acc: [[0.025, 75, 60, 42]] },
  { h: [32, 43], s: [64, 76], l: [55, 63], acc: [[0.025, 16, 68, 55]] },
  { h: [194, 212], s: [38, 54], l: [70, 79], acc: [[0.03, 262, 50, 80]] },
  { h: [352, 368], s: [42, 56], l: [16, 23], acc: [[0.035, 24, 92, 48]] },
];
const WATER = { h: [206, 226], s: [70, 84], l: [38, 50] };
const ICE_WATER = { h: [196, 212], s: [58, 74], l: [50, 60] };
const LAVA = { h: [14, 34], s: [94, 100], l: [48, 58] };

// Half length and half width of each weapon's projectile shard, by weapon index.
const SHOT = [[9, 3.2], [6.5, 3], [8, 1.8], [17, 4.2], [8, 6.5], [6, 3.8]];

function facet(seed, tx, ty, k, biome, liquid) {
  const a = tx * 2 + k;
  const pal = liquid ? (biome === 4 ? LAVA : biome === 3 ? ICE_WATER : WATER) : PAL[biome];
  if (!liquid) {
    let q = hash01(a, ty, seed + 63);
    for (const [p, h, s, l] of pal.acc) { if (q < p) return [h, s, l]; q -= p; }
  }
  // a slow field adds lighter and darker patches so large areas do not look uniform
  const field = (fbm(tx * 0.09, ty * 0.09, seed + 64, 2) - 0.5) * 10;
  return [
    lerp(pal.h[0], pal.h[1], hash01(a, ty, seed + 61)),
    lerp(pal.s[0], pal.s[1], hash01(a, ty, seed + 62)),
    lerp(pal.l[0], pal.l[1], hash01(a, ty, seed + 65)) + field,
  ];
}

// Coloured line with a lead outline; pts holds segment pairs.
function strokes(g, pts, color, lw) {
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = pass ? color : LEAD;
    g.lineWidth = pass ? lw : lw + 2;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 4) { g.moveTo(pts[i], pts[i + 1]); g.lineTo(pts[i + 2], pts[i + 3]); }
    g.stroke();
  }
}

function hpBar(g, x, y, w, frac, color) {
  g.fillStyle = LEAD;
  g.fillRect(x - w / 2 - 1.5, y - 1.5, w + 3, 7);
  g.fillStyle = '#3a1826';
  g.fillRect(x - w / 2, y, w, 4);
  g.fillStyle = color;
  g.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 4);
}

// Full-screen radial tint: clear up to radius r0 (of 128), reaching the outer colour at r1.
function radialOverlay(inner, outer, r0, r1) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, r0, 128, 128, r1);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.clock = 0;
    this.frame = 0;
    this.snap = true;
    this.parts = [];
    this.chunks = new Map(); // chunk key -> cached mosaic
    this.visible = [];
    this.lights = []; // flat [x, y, r, color, alpha] records for the night light map
    this.glows = []; // same layout, drawn additively above the shading
    this.world = null;
    this.res = 0;
    this.lightCanvas = document.createElement('canvas');
    this.lctx = this.lightCanvas.getContext('2d');
    this.vignette = radialOverlay('rgba(6,4,14,0)', 'rgba(6,4,14,0.5)', 92, 186);
    this.hurt = radialOverlay('rgba(255,40,70,0)', 'rgba(255,40,70,0.6)', 116, 186);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, window.innerWidth), h = Math.max(240, window.innerHeight);
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = Math.max(this.canvas.height / VIEW_H, this.canvas.width / VIEW_W);
    this.viewW = this.canvas.width / this.scale;
    this.viewH = this.canvas.height / this.scale;
    // Cached art is rasterised close to the on-screen scale so the lead lines stay crisp.
    const res = clamp(Math.ceil(this.scale * 4) / 4, 1, 2);
    if (res !== this.res) { this.res = res; this.chunks.clear(); S.setSpriteRes(res); }
    this.lightCanvas.width = Math.ceil(this.canvas.width / 4);
    this.lightCanvas.height = Math.ceil(this.canvas.height / 4);
  }

  reset() {
    this.chunks.clear();
    this.parts.length = 0;
    this.shake = 0;
    this.snap = true;
  }

  // Client (CSS pixel) coordinates to world coordinates.
  screenToWorld(mx, my) {
    return {
      x: this.cam.x + (mx * this.dpr - this.canvas.width / 2) / this.scale,
      y: this.cam.y + (my * this.dpr - this.canvas.height / 2) / this.scale,
    };
  }

  // ------------------------------------------------------------------ terrain

  buildChunk(world, chunk) {
    const res = this.res, n = CHUNK_TILES, m = n + 1, seed = world.seed;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil((CHUNK + PAD * 2) * res);
    const g = cv.getContext('2d');
    g.setTransform(res, 0, 0, res, (PAD - chunk.cx * CHUNK) * res, (PAD - chunk.cy * CHUNK) * res);
    g.lineJoin = 'round';
    const xs = new Float64Array(m * m), ys = new Float64Array(m * m);
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        xs[j * m + i] = world.cornerX(chunk.cx * n + i, chunk.cy * n + j);
        ys[j * m + i] = world.cornerY(chunk.cx * n + i, chunk.cy * n + j);
      }
    }
    const lead = new Path2D(), quads = [], phase = [], lava = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i, tx = chunk.cx * n + i, ty = chunk.cy * n + j;
        const biome = chunk.tiles[idx], liquid = chunk.liquid[idx] === 1;
        const a = j * m + i, b = a + 1, d = a + m, c = d + 1; // corners: a b over d c
        const tris = hash2(tx, ty, seed + 66) & 1 ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
        for (let k = 0; k < 2; k++) {
          const p0 = tris[k * 3], p1 = tris[k * 3 + 1], p2 = tris[k * 3 + 2];
          const [h, s, l] = facet(seed, tx, ty, k, biome, liquid);
          const gr = g.createLinearGradient(xs[p0], ys[p0], (xs[p1] + xs[p2]) / 2, (ys[p1] + ys[p2]) / 2);
          gr.addColorStop(0, `hsl(${h},${s}%,${l + 4}%)`);
          gr.addColorStop(1, `hsl(${h},${s}%,${l - 3}%)`);
          g.fillStyle = gr;
          g.beginPath();
          g.moveTo(xs[p0], ys[p0]); g.lineTo(xs[p1], ys[p1]); g.lineTo(xs[p2], ys[p2]);
          g.closePath();
          g.fill();
          lead.moveTo(xs[p0], ys[p0]); lead.lineTo(xs[p1], ys[p1]); lead.lineTo(xs[p2], ys[p2]);
          lead.closePath();
        }
        if (liquid) {
          quads.push(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], xs[d], ys[d]);
          phase.push(hash01(tx, ty, seed + 67) * TAU);
          lava.push(biome === 4);
        }
      }
    }
    g.strokeStyle = 'rgba(13,11,24,0.7)'; // softer than the outlines of things standing on the ground
    g.lineWidth = 2;
    g.stroke(lead);
    this.decals(g, world, chunk);
    return { canvas: cv, chunk, quads, phase, lava, used: this.frame };
  }

  // Small details baked into the mosaic: flowers, leaves, dunes, frost and embers.
  decals(g, world, chunk) {
    const n = CHUNK_TILES, seed = world.seed;
    g.lineCap = 'round';
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        if (chunk.liquid[idx]) continue;
        const tx = chunk.cx * n + i, ty = chunk.cy * n + j, h = hash01(tx, ty, seed + 71);
        if (h > 0.22) continue;
        const k = h / 0.22;
        const x = (tx + 0.25 + hash01(tx, ty, seed + 72) * 0.5) * TILE, y = (ty + 0.25 + hash01(tx, ty, seed + 73) * 0.5) * TILE;
        switch (chunk.tiles[idx]) {
          case 0:
            if (k < 0.45) {
              const c = k < 0.18 ? '#ffe27a' : k < 0.32 ? '#ffffff' : '#ff9ad0';
              S.fan(g, x, y, 8, (q) => (q % 2 ? 2.2 : 5.6), k * 30, [c, c], 1);
              S.dot(g, x, y, 1.5, '#ffb03a', 0);
            } else strokes(g, [x - 4, y + 3, x - 6, y - 4, x, y + 3, x, y - 6, x + 4, y + 3, x + 6, y - 4], '#9be87a', 2);
            break;
          case 1:
            if (k < 0.3) { S.dot(g, x, y, 3.6, '#c9824a', 1.3); S.dot(g, x - 1, y - 1, 1, '#f4e6c8', 0); }
            else S.diamond(g, x, y, k * 20, 5.5, 2.6, '#e0a03c', '#b8742a', 1);
            break;
          case 2:
            if (k < 0.7) {
              g.strokeStyle = 'rgba(255,244,205,0.6)';
              g.lineWidth = 1.6;
              g.beginPath();
              g.moveTo(x - 9, y); g.quadraticCurveTo(x, y - 6, x + 9, y);
              g.moveTo(x - 5, y + 5); g.quadraticCurveTo(x + 2, y + 1, x + 9, y + 5);
              g.stroke();
            } else S.fan(g, x, y, 5, 3.6, k * 9, ['#c9a070', '#a8824f'], 1);
            break;
          case 3:
            if (k < 0.55) S.fan(g, x, y, 8, (q) => (q % 2 ? 1.4 : 5.2), 0, ['#ffffff', '#ffffff'], 0);
            else {
              g.strokeStyle = 'rgba(70,120,160,0.55)';
              g.lineWidth = 1.4;
              g.beginPath();
              g.moveTo(x - 8, y - 3); g.lineTo(x - 2, y + 2); g.lineTo(x + 3, y - 2); g.lineTo(x + 9, y + 3);
              g.stroke();
            }
            break;
          default:
            if (k < 0.7) strokes(g, [x - 8, y - 3, x - 2, y + 2, x - 2, y + 2, x + 3, y - 2, x + 3, y - 2, x + 9, y + 3], '#ff8a3a', 1.8);
            else { S.dot(g, x, y, 2, 'rgba(10,8,16,0.55)', 0); S.dot(g, x + 6, y + 3, 1.4, 'rgba(10,8,16,0.55)', 0); }
        }
      }
    }
    g.lineCap = 'butt';
  }

  evict() {
    for (const [key, art] of this.chunks) if (this.frame - art.used > 240) this.chunks.delete(key);
  }

  // ------------------------------------------------------------------ effects

  burst(x, y, color, n, speed, size, life = 0.6) {
    for (let i = 0; i < n && this.parts.length < 700; i++) {
      const a = Math.random() * TAU, s = speed * (0.35 + Math.random() * 0.65), l = life * (0.6 + Math.random() * 0.6);
      this.parts.push({
        k: 0, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, max: l, size: size * (0.6 + Math.random() * 0.7),
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14, color,
      });
    }
  }

  sparks(x, y, color, n, speed) {
    for (let i = 0; i < n && this.parts.length < 700; i++) {
      const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.6), l = 0.18 + Math.random() * 0.2;
      this.parts.push({ k: 1, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, max: l, color });
    }
  }

  ring(x, y, r, color, life = 0.35) { this.parts.push({ k: 2, x, y, vx: 0, vy: 0, life, max: life, size: r, color }); }

  text(x, y, str, color, size) {
    if (this.parts.length > 600) return;
    this.parts.push({ k: 3, x: x + (Math.random() - 0.5) * 14, y, vx: 0, vy: -46, life: 0.7, max: 0.7, size, color, str });
  }

  flash(x, y, r, color, life = 0.14) { this.parts.push({ k: 4, x, y, vx: 0, vy: 0, life, max: life, size: r, color }); }

  // Turns simulation events into particles and screen shake.
  onEvent(e) {
    switch (e.type) {
      case 'shoot': {
        const x = e.x + Math.cos(e.a) * 30, y = e.y + Math.sin(e.a) * 30;
        this.flash(x, y, 22, e.color, 0.07);
        if (e.weapon === 'prism' || e.weapon === 'comet' || e.weapon === 'fan') this.shake = Math.max(this.shake, 3);
        break;
      }
      case 'hit': this.sparks(e.x, e.y, e.color, 4, 240); break;
      case 'spark': this.sparks(e.x, e.y, e.color, 3, 160); break;
      case 'dmg': this.text(e.x, e.y, String(Math.max(1, Math.round(e.n))), '#ffffff', e.n >= 30 ? 19 : 14); break;
      case 'kill':
        this.burst(e.x, e.y, e.color, 8 + Math.round(e.r * 0.4), 300, 7 + e.r * 0.25);
        this.burst(e.x, e.y, '#ffffff', 3, 220, 5);
        this.ring(e.x, e.y, e.r * 2.6, e.color);
        this.flash(e.x, e.y, e.r * 3, e.color);
        this.shake = Math.max(this.shake, e.elite ? 6 : 2.5);
        break;
      case 'nodeHit': this.burst(e.x, e.y, e.color, 2, 180, 5, 0.4); break;
      case 'nodeBreak':
        this.burst(e.x, e.y, e.color, 10, 260, 8);
        this.ring(e.x, e.y, e.r * 2.4, e.color);
        break;
      case 'boom':
        this.ring(e.x, e.y, e.r, e.color, 0.4);
        this.flash(e.x, e.y, e.r * 1.6, e.color, 0.2);
        this.burst(e.x, e.y, e.color, 12, 380, 8);
        this.shake = Math.max(this.shake, e.hostile ? 7 : 5);
        break;
      case 'hurt':
        this.shake = Math.max(this.shake, 8);
        this.burst(e.x, e.y, '#ff5d7a', 6, 260, 6, 0.4);
        this.text(e.x, e.y - 20, '−' + Math.max(1, Math.round(e.n)), '#ff6a7a', 18);
        break;
      case 'pickup':
        this.sparks(e.x, e.y, ITEMS[e.kind].color, 4, 120);
        if (e.kind === 'heart') this.text(e.x, e.y - 14, '+18', '#ff8ba0', 14);
        else if (e.kind !== 'essence') this.text(e.x, e.y - 14, '+' + e.n, ITEMS[e.kind].color, 13);
        break;
      case 'dash': this.burst(e.x, e.y, '#6fa0ff', 7, 200, 7, 0.35); break;
      case 'plant': this.sparks(e.x, e.y, '#9be87a', 8, 150); this.ring(e.x, e.y, 30, '#9be87a'); break;
      case 'harvest': this.burst(e.x, e.y, CROPS[e.crop].color, 8, 220, 6); this.ring(e.x, e.y, 46, CROPS[e.crop].color); break;
      case 'eat': this.ring(e.x, e.y, 54, ITEMS[e.kind].color, 0.45); this.sparks(e.x, e.y, ITEMS[e.kind].color, 10, 220); break;
      case 'upgrade':
      case 'craft': this.ring(e.x, e.y, 90, '#ffd27a', 0.6); this.sparks(e.x, e.y, '#ffd27a', 16, 300); break;
      case 'recall': this.ring(e.x, e.y, 120, '#ffe9b0', 0.6); this.burst(e.x, e.y, '#ffe9b0', 14, 300, 7); break;
      case 'respawn': this.ring(e.x, e.y, 140, '#ffe9b0', 0.7); this.snap = true; break;
      case 'death': this.burst(e.x, e.y, '#3f7bff', 26, 420, 10, 1); this.burst(e.x, e.y, '#ffd27a', 8, 300, 7, 1); this.shake = 14; break;
      case 'bossStart': this.ring(e.x, e.y, 320, e.color, 0.9); this.ring(e.x, e.y, 180, '#ffffff', 0.7); this.shake = 12; break;
      case 'bossPhase': this.ring(e.x, e.y, 260, e.color, 0.7); this.flash(e.x, e.y, 320, e.color, 0.3); this.shake = 10; break;
      case 'bossDead':
        this.burst(e.x, e.y, e.color, 60, 620, 13, 1.3);
        this.burst(e.x, e.y, '#ffffff', 24, 480, 9, 1.1);
        for (let i = 1; i <= 3; i++) this.ring(e.x, e.y, 150 * i, i === 2 ? '#ffffff' : e.color, 0.4 + i * 0.25);
        this.flash(e.x, e.y, 520, '#ffffff', 0.4);
        this.shake = 18;
        break;
    }
  }

  // ------------------------------------------------------------------ frame

  draw(game, dt, opts = {}) {
    const ctx = this.ctx, cv = this.canvas, p = game.player, world = game.world, cam = this.cam, sc = this.scale;
    if (world !== this.world) { this.world = world; this.reset(); }
    this.frame++;
    this.clock += dt;
    const t = this.clock, now = game.time;

    if (opts.camera) { cam.x = opts.camera.x; cam.y = opts.camera.y; } else {
      // look a little ahead towards the cursor
      const mx = opts.mouse ? (((opts.mouse.x - this.cssW / 2) * this.dpr) / sc) * 0.13 : 0;
      const my = opts.mouse ? (((opts.mouse.y - this.cssH / 2) * this.dpr) / sc) * 0.13 : 0;
      const k = this.snap ? 1 : 1 - Math.exp(-dt * 9);
      cam.x += (p.x + mx - cam.x) * k;
      cam.y += (p.y + my - cam.y) * k;
    }
    this.snap = false;
    this.shake *= Math.exp(-dt * 9);
    const sx = (Math.random() - 0.5) * this.shake * 2, sy = (Math.random() - 0.5) * this.shake * 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = LEAD;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(sc, 0, 0, sc, Math.round(cv.width / 2 - (cam.x + sx) * sc), Math.round(cv.height / 2 - (cam.y + sy) * sc));
    ctx.lineJoin = 'round';

    const x0 = cam.x - this.viewW / 2 - 10, x1 = cam.x + this.viewW / 2 + 10;
    const y0 = cam.y - this.viewH / 2 - 10, y1 = cam.y + this.viewH / 2 + 10;
    const inView = (x, y, r) => x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r;
    const lights = this.lights, glows = this.glows, dark = game.darkness;
    lights.length = 0;
    glows.length = 0;

    // Terrain mosaics.
    const arts = this.visible;
    arts.length = 0;
    const cx0 = Math.floor((x0 - PAD) / CHUNK), cx1 = Math.floor((x1 + PAD) / CHUNK);
    const cy0 = Math.floor((y0 - PAD) / CHUNK), cy1 = Math.floor((y1 + PAD) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = world.getChunk(cx, cy);
        let art = this.chunks.get(chunk.key);
        if (!art) { art = this.buildChunk(world, chunk); this.chunks.set(chunk.key, art); }
        art.used = this.frame;
        art.chunk = chunk;
        arts.push(art);
        ctx.drawImage(art.canvas, cx * CHUNK - PAD, cy * CHUNK - PAD, CHUNK + PAD * 2, CHUNK + PAD * 2);
      }
    }
    if (this.chunks.size > 70) this.evict();

    // Water glints and lava glow ripple across the liquid panes.
    ctx.globalCompositeOperation = 'lighter';
    for (const art of arts) {
      const q = art.quads;
      for (let i = 0, k = 0; i < q.length; i += 8, k++) {
        const wave = 0.5 + 0.5 * Math.sin(t * 1.7 + art.phase[k]);
        ctx.globalAlpha = art.lava[k] ? 0.1 + 0.2 * wave : 0.04 + 0.1 * wave;
        ctx.fillStyle = art.lava[k] ? '#ffb45a' : '#bfe6ff';
        ctx.beginPath();
        ctx.moveTo(q[i], q[i + 1]); ctx.lineTo(q[i + 2], q[i + 3]); ctx.lineTo(q[i + 4], q[i + 5]); ctx.lineTo(q[i + 6], q[i + 7]);
        ctx.fill();
        if (art.lava[k] && dark > 0.02) lights.push((q[i] + q[i + 4]) / 2, (q[i + 1] + q[i + 5]) / 2, 90, '#ff7a2a', 0.55);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Landmarks on the ground: the beacon and the guardian altars.
    if (inView(0, 0, HOME_RADIUS + 20)) {
      S.drawSprite(ctx, S.beaconSprite(), 0, 0);
      ctx.setLineDash([14, 18]);
      ctx.lineDashOffset = -t * 14;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,226,122,0.42)';
      ctx.beginPath();
      ctx.arc(0, 0, HOME_RADIUS, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      lights.push(0, 0, 640, '#ffe9b0', 1);
      glows.push(0, 0, 80 + Math.sin(t * 2) * 8, '#ffe9b0', 0.5);
    }
    for (const l of world.lairs) {
      if (!inView(l.x, l.y, ARENA_RADIUS + 20)) continue;
      const def = BOSSES[l.id], active = game.boss && game.boss.lair === l;
      ctx.setLineDash([22, 16]);
      ctx.lineDashOffset = t * 10;
      ctx.lineWidth = active ? 5 : 3;
      ctx.strokeStyle = S.rgba(def.color, active ? 0.75 : 0.38);
      ctx.beginPath();
      ctx.arc(l.x, l.y, ARENA_RADIUS, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      S.drawSprite(ctx, S.altarSprite(l.id), l.x, l.y);
      lights.push(l.x, l.y, 320, def.color, 0.85);
      if (!active) glows.push(l.x, l.y, 62 + Math.sin(t * 3) * 14, def.color, 0.6);
    }

    // Farm plots.
    for (const c of game.crops.values()) {
      if (!inView(c.x, c.y, 32)) continue;
      const pr = game.cropProgress(c), ripe = pr >= 1, color = CROPS[c.type].color;
      S.drawSprite(ctx, S.cropSprite(c.type, ripe ? 3 : Math.floor(pr * 3)), c.x, c.y, 0, ripe ? 1 + Math.sin(t * 4 + c.tx) * 0.05 : 1);
      if (ripe) {
        glows.push(c.x, c.y, 36, color, 0.45 + 0.2 * Math.sin(t * 4 + c.tx));
        lights.push(c.x, c.y, 120, color, 0.7);
      } else {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 23, -Math.PI / 2, -Math.PI / 2 + pr * TAU);
        ctx.stroke();
      }
    }
    if (game.spot && p.alive) {
      const s = game.spot;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = s.ok ? 'rgba(160,255,140,0.9)' : 'rgba(255,90,90,0.9)';
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(s.x - 20, s.y - 20, 40, 40);
      ctx.setLineDash([]);
      if (s.ok) {
        ctx.globalAlpha = 0.6;
        S.drawSprite(ctx, S.iconSprite(CROPS[p.seedSel].seed), s.x, s.y, 0, 0.9);
        ctx.globalAlpha = 1;
      }
    }

    // Resource nodes.
    for (const art of arts) {
      for (const n of art.chunk.nodes) {
        if (!inView(n.x, n.y, 44)) continue;
        if (n.deadUntil > now) { S.drawSprite(ctx, S.stumpSprite(), n.x, n.y, n.rot); continue; }
        const hit = now - n.hitAt, born = now - n.deadUntil, spr = S.nodeSprite(n);
        let k = n.sc;
        ctx.fillStyle = 'rgba(8,6,18,0.26)';
        ctx.beginPath();
        ctx.arc(n.x + 4, n.y + 7, n.def.vr * n.sc * 0.92, 0, TAU);
        ctx.fill();
        if (hit < 0.16) k *= 1 + (0.16 - hit) * 0.9;
        if (n.deadUntil > 0 && born < 0.5) k *= 0.3 + 1.4 * born;
        S.drawSprite(ctx, spr, n.x, n.y, n.rot, k);
        if (hit < 0.1) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.55;
          S.drawSprite(ctx, spr, n.x, n.y, n.rot, k);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        if (n.def.glow) {
          glows.push(n.x, n.y, n.def.vr * 1.5, n.def.glow, 0.28 + 0.1 * Math.sin(t * 2 + n.rot * 5));
          lights.push(n.x, n.y, 160, n.def.glow, 0.75);
        }
      }
    }

    // Loot.
    for (const k of game.pickups) {
      if (!inView(k.x, k.y, 20) || (k.life < 6 && Math.sin(k.life * 14) > 0.3)) continue;
      const color = ITEMS[k.kind].color;
      S.drawSprite(ctx, S.iconSprite(k.kind), k.x, k.y, 0, 0.72 + Math.sin(t * 5 + k.x * 0.05) * 0.06 + Math.min(0.2, k.n * 0.012));
      glows.push(k.x, k.y, 18, color, 0.4);
      lights.push(k.x, k.y, 60, color, 0.5);
    }

    // Creatures.
    for (const m of game.mobs) {
      if (m.dead || !inView(m.x, m.y, m.r * 2.6)) continue;
      const def = m.def, k = (m.r / def.r) * ART_SCALE * Math.min(1, 0.4 + m.age * 2.4), fly = def.flying;
      ctx.fillStyle = 'rgba(8,6,18,0.28)';
      ctx.beginPath();
      ctx.ellipse(m.x + 3, m.y + (fly ? 16 : 6), m.r * (fly ? 0.7 : 1), m.r * (fly ? 0.5 : 0.8), 0, 0, TAU);
      ctx.fill();
      if (m.elite) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,214,102,0.85)';
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 1.35 + Math.sin(t * 6) * 1.5, 0, TAU);
        ctx.stroke();
        glows.push(m.x, m.y, m.r * 3, '#ffd666', 0.35);
      }
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.scale(k, k);
      S.MOB_ART[m.type](ctx, m, def.r);
      ctx.restore();
      if (m.hitT > 0) glows.push(m.x, m.y, m.r * 1.9, '#ffffff', (m.hitT / 0.12) * 0.8);
      const warn = m.state === 'aim' || m.state === 'windup' || m.state === 'fuse' || m.state === 'slam' || m.state === 'fire';
      glows.push(m.x, m.y, m.r * (warn ? 3 : 2.2), warn ? '#ff4a5a' : def.color, warn ? 0.5 : 0.2);
      lights.push(m.x, m.y, m.r * 5, def.color, 0.45);
      if (m.hp < m.maxHp) hpBar(ctx, m.x, m.y - m.r - 10, m.r * 1.7, m.hp / m.maxHp, m.elite ? '#ffd666' : '#ff5d7a');
    }

    // Guardian.
    const b = game.boss;
    if (b && !b.hidden) {
      const intro = b.state === 'intro' ? clamp(1 - b.st / 1.6, 0, 1) : 1;
      ctx.fillStyle = 'rgba(8,6,18,0.3)';
      ctx.beginPath();
      ctx.ellipse(b.x + 4, b.y + 10, b.r * 1.15, b.r * 0.9, 0, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(0.2 + 0.8 * intro * (2 - intro), 0.2 + 0.8 * intro * (2 - intro));
      ctx.globalAlpha = Math.min(1, intro * 2.5);
      S.BOSS_ART[b.id](ctx, b, t, Math.atan2(p.y - b.y, p.x - b.x));
      ctx.restore();
      if (b.hitT > 0) glows.push(b.x, b.y, b.r * 1.8, '#ffffff', (b.hitT / 0.1) * 0.6);
      glows.push(b.x, b.y, b.r * 3.2, b.def.color, 0.28 + 0.1 * Math.sin(t * 4));
      lights.push(b.x, b.y, 480, b.def.color, 0.95);
    }

    // Player.
    if (p.alive) {
      ctx.fillStyle = 'rgba(8,6,18,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x + 3, p.y + 6, p.r, p.r * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(ART_SCALE, ART_SCALE);
      if (p.invuln > 0 && p.dashT <= 0 && Math.sin(t * 40) > 0) ctx.globalAlpha = 0.55;
      S.drawPlayer(ctx, p, t, WEAPONS[p.weapon].color);
      ctx.restore();
      if (p.hurtT > 0) glows.push(p.x, p.y, p.r * 2.4, '#ff6a7a', (p.hurtT / 0.3) * 0.8);
      if (p.buffs.rage > 0) glows.push(p.x, p.y, 44, '#ff6a3a', 0.35);
      if (p.buffs.frost > 0) glows.push(p.x, p.y, 44, '#c9b5ff', 0.35);
      if (p.recall > 0) {
        const k = p.recall / RECALL_TIME;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,233,176,0.9)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16 + 60 * (1 - k), 0, TAU);
        ctx.stroke();
        glows.push(p.x, p.y, 40 + k * 60, '#ffe9b0', 0.3 + k * 0.5);
      }
      lights.push(p.x, p.y, 340, '#fff4d6', 1);
    }

    // Night: multiply the scene by a light map in which every glowing thing punches a hole.
    if (dark > 0.02) {
      for (const s of game.bullets) lights.push(s.x, s.y, 80, s.color, 0.7);
      for (const s of game.ebullets) lights.push(s.x, s.y, 60, s.color, 0.6);
      for (const h of game.hazards) lights.push(h.x, h.y, h.r * 1.6, h.color, 0.6);
      for (const q of this.parts) if (q.k === 4) lights.push(q.x, q.y, q.size * 2, q.color, q.life / q.max);
      const L = this.lctx, lw = this.lightCanvas.width, lh = this.lightCanvas.height, ls = sc / 4;
      L.globalCompositeOperation = 'source-over';
      L.globalAlpha = 1;
      L.fillStyle = `rgb(${Math.round(255 - dark * 197)},${Math.round(255 - dark * 189)},${Math.round(255 - dark * 122)})`;
      L.fillRect(0, 0, lw, lh);
      L.globalCompositeOperation = 'lighter';
      for (let i = 0; i < lights.length; i += 5) {
        const r = lights[i + 2] * ls;
        L.globalAlpha = lights[i + 4] * dark;
        L.drawImage(S.glowSprite(lights[i + 3]), (lights[i] - cam.x - sx) * ls + lw / 2 - r, (lights[i + 1] - cam.y - sy) * ls + lh / 2 - r, r * 2, r * 2);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.lightCanvas, 0, 0, cv.width, cv.height);
      ctx.restore();
    }

    // Everything that shines is drawn above the shading so it stays readable at night.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < glows.length; i += 5) {
      const r = glows[i + 2];
      ctx.globalAlpha = clamp(glows[i + 4], 0, 1);
      ctx.drawImage(S.glowSprite(glows[i + 3]), glows[i] - r, glows[i + 1] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const h of game.hazards) {
      const k = h.delay > 0 ? clamp(h.t / h.delay, 0, 1) : 1;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, TAU);
      ctx.fillStyle = S.rgba(h.color, 0.1 + 0.08 * k);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = S.rgba(h.color, 0.9);
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t * 40;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * k, 0, TAU);
      ctx.fillStyle = S.rgba(h.color, 0.3);
      ctx.fill();
    }
    if (b) S.drawBossFx(ctx, b);
    this.drawShots(ctx, game);
    this.drawParticles(ctx, dt);

    // Screen-space finish: vignette and damage tint.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.vignette, 0, 0, cv.width, cv.height);
    const st = game.st, low = p.alive && p.hp < st.maxHp * 0.3 ? 0.25 + 0.15 * Math.sin(t * 6) : 0;
    const red = Math.max(low, p.hurtT / 0.3);
    if (red > 0.01) {
      ctx.globalAlpha = clamp(red, 0, 1);
      ctx.drawImage(this.hurt, 0, 0, cv.width, cv.height);
      ctx.globalAlpha = 1;
    }
  }

  drawShots(ctx, game) {
    const bs = game.bullets, es = game.ebullets;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of bs) {
      const r = s.r * (s.explode ? 4.5 : 3.4);
      ctx.drawImage(S.glowSprite(s.color), s.x - r, s.y - r, r * 2, r * 2);
    }
    for (const s of es) {
      const r = s.r * 2.8;
      ctx.drawImage(S.glowSprite(s.color), s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = LEAD;
    // The player's shots are slim shards with a hot white core.
    ctx.lineWidth = 2;
    for (const s of bs) {
      const sp = Math.hypot(s.vx, s.vy) || 1, cx = s.vx / sp, cy = s.vy / sp, L = SHOT[s.w][0], W = SHOT[s.w][1];
      ctx.beginPath();
      ctx.moveTo(s.x + cx * L, s.y + cy * L);
      ctx.lineTo(s.x - cy * W, s.y + cx * W);
      ctx.lineTo(s.x - cx * L * 1.5, s.y - cy * L * 1.5);
      ctx.lineTo(s.x + cy * W, s.y - cx * W);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x + cx * L * 0.5, s.y + cy * L * 0.5);
      ctx.lineTo(s.x - cy * W * 0.4, s.y + cx * W * 0.4);
      ctx.lineTo(s.x - cx * L * 0.6, s.y - cy * L * 0.6);
      ctx.lineTo(s.x + cy * W * 0.4, s.y - cx * W * 0.4);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    // Hostile shots are spinning thorn stars, clearly different from the player's.
    ctx.lineWidth = 2;
    for (const s of es) {
      const rot = s.age * 5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = rot + i * (TAU / 6), r = s.r * (i % 2 ? 0.72 : 1.3);
        ctx.lineTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 0.36, 0, TAU);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }

  drawParticles(ctx, dt) {
    const ps = this.parts, fr = Math.exp(-dt * 3.2);
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Solid kinds first (glass shards and floating numbers); they are also advanced here.
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.life -= dt;
      if (q.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.k === 0) {
        q.vx *= fr; q.vy *= fr; q.rot += q.vr * dt;
        const c = Math.cos(q.rot) * q.size, s = Math.sin(q.rot) * q.size;
        ctx.globalAlpha = Math.min(1, (q.life / q.max) * 1.6);
        ctx.beginPath();
        ctx.moveTo(q.x + c, q.y + s);
        ctx.lineTo(q.x - 0.6 * c - 0.7 * s, q.y - 0.6 * s + 0.7 * c);
        ctx.lineTo(q.x - 0.6 * c + 0.5 * s, q.y - 0.6 * s - 0.5 * c);
        ctx.closePath();
        ctx.fillStyle = q.color;
        ctx.fill();
        ctx.strokeStyle = LEAD;
        ctx.stroke();
      } else if (q.k === 1) { q.vx *= fr; q.vy *= fr; } else if (q.k === 3) {
        ctx.globalAlpha = Math.min(1, (q.life / q.max) * 2);
        ctx.font = `800 ${q.size}px ${FONT}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = LEAD;
        ctx.strokeText(q.str, q.x, q.y);
        ctx.fillStyle = q.color;
        ctx.fillText(q.str, q.x, q.y);
        ctx.lineWidth = 1;
      }
    }
    // Light kinds: sparks, shock rings and flashes.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const q of ps) {
      const a = q.life / q.max;
      if (q.k === 1) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = q.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035);
        ctx.stroke();
      } else if (q.k === 2) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = q.color;
        ctx.lineWidth = 2 + 6 * a;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.size * (1 - a * a * 0.85), 0, TAU);
        ctx.stroke();
      } else if (q.k === 4) {
        ctx.globalAlpha = a * 0.8;
        ctx.drawImage(S.glowSprite(q.color), q.x - q.size, q.y - q.size, q.size * 2, q.size * 2);
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
