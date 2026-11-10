// Heads-up display drawn on the game canvas: health, weapons, resources, minimap, prompts and the world map.
import { WEAPONS, CROPS, BIOMES, BIOME_IDS, BOSSES } from './config.js';
import { TAU, clamp } from './util.js';
import { LEAD, iconSprite, drawSprite } from './sprites.js';

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const GLASS = 'rgba(18,15,36,0.84)';
const CROP_IDS = Object.keys(CROPS);
const MAP_COL = BIOME_IDS.map((id) => BIOMES[id].map);
const WATER_COL = [42, 98, 196], ICE_COL = [120, 180, 220], LAVA_COL = [255, 122, 26];
const TONES = { boss: '#ff6ad5', night: '#8fb4ff', day: '#ffd27a', good: '#b6ff8a' };
const MINI_RANGE = 2600; // world units from the player to the rim of the minimap

function label(g, str, x, y, size, color = '#ffffff', align = 'left', weight = 700) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(3, size * 0.26);
  g.strokeStyle = LEAD;
  g.strokeText(str, x, y);
  g.fillStyle = color;
  g.fillText(str, x, y);
}

// Panel with cut corners, like a pane of dark glass.
function pane(g, x, y, w, h, cut = 9, fill = GLASS, edge = LEAD, lw = 3) {
  g.beginPath();
  g.moveTo(x + cut, y); g.lineTo(x + w - cut, y); g.lineTo(x + w, y + cut); g.lineTo(x + w, y + h - cut);
  g.lineTo(x + w - cut, y + h); g.lineTo(x + cut, y + h); g.lineTo(x, y + h - cut); g.lineTo(x, y + cut);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = edge;
  g.stroke();
}

function keycap(g, key, x, y, on = true) {
  const w = Math.max(20, 10 + key.length * 8);
  pane(g, x - w / 2, y - 10, w, 20, 4, on ? '#f1e6c8' : '#6b6578', LEAD, 2);
  g.font = `800 12px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = LEAD;
  g.fillText(key, x, y + 0.5);
}

const icon = (g, kind, x, y, size) => drawSprite(g, iconSprite(kind), x, y, 0, size / 30);

function diamondMark(g, x, y, r, color) {
  g.beginPath();
  g.moveTo(x, y - r); g.lineTo(x + r * 0.85, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.85, y);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = LEAD;
  g.stroke();
}

function arrowMark(g, x, y, a, size, color) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.beginPath();
  g.moveTo(size, 0); g.lineTo(-size * 0.7, -size * 0.75); g.lineTo(-size * 0.3, 0); g.lineTo(-size * 0.7, size * 0.75);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 1.8;
  g.strokeStyle = LEAD;
  g.stroke();
  g.restore();
}

// Low-resolution biome map sampled straight from the world noise (no chunks are generated).
class MapTexture {
  constructor(n) {
    this.n = n;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = n;
    this.g = this.canvas.getContext('2d');
    this.img = this.g.createImageData(n, n);
    this.world = null;
    this.cx = 0; this.cy = 0; this.range = 1;
  }

  render(world, cx, cy, range) {
    const n = this.n, d = this.img.data, step = (range * 2) / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cx - range + (i + 0.5) * step, y = cy - range + (j + 0.5) * step, b = world.biomeAt(x, y);
        const col = world.liquidRaw(x, y, b) ? (b === 4 ? LAVA_COL : b === 3 ? ICE_COL : WATER_COL) : MAP_COL[b];
        const k = (i + j) & 1 ? 1 : 0.92, o = (j * n + i) * 4; // checker shading hints at the mosaic
        d[o] = col[0] * k; d[o + 1] = col[1] * k; d[o + 2] = col[2] * k; d[o + 3] = 255;
      }
    }
    this.g.putImageData(this.img, 0, 0);
    this.world = world; this.cx = cx; this.cy = cy; this.range = range;
  }
}

export class Hud {
  constructor() {
    this.mini = new MapTexture(72);
    this.big = new MapTexture(220);
  }

  // view: { cssW, cssH, dpr }; ui: { mode, toasts, mouse, hint }
  draw(g, view, game, ui) {
    const s = clamp(Math.min(view.cssH / 820, view.cssW / 1250), 0.7, 1.3), W = view.cssW / s, H = view.cssH / s;
    g.setTransform(view.dpr * s, 0, 0, view.dpr * s, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.lineJoin = 'round';
    this.health(g, game);
    this.resources(g, game, H);
    this.farm(g, game, W, H);
    this.weapons(g, game, W, H);
    this.minimap(g, game, W);
    this.bossBar(g, game, W);
    this.toasts(g, ui.toasts, W, game.boss ? 90 : 26);
    this.prompt(g, game, W, H, ui.hint);
    if (ui.mode === 'map') this.worldMap(g, game, W, H);
    else if (ui.mode === 'play') this.crosshair(g, game, ui.mouse.x / s, ui.mouse.y / s);
  }

  health(g, game) {
    const p = game.player, st = game.st, x = 16, y = 16;
    pane(g, x, y, 292, 64);
    icon(g, 'heart', x + 24, y + 22, 26);
    const bx = x + 46, by = y + 11, bw = 232, bh = 22, f = clamp(p.hp / st.maxHp, 0, 1);
    g.fillStyle = '#2a1220';
    g.fillRect(bx, by, bw, bh);
    const gr = g.createLinearGradient(bx, 0, bx + bw, 0);
    gr.addColorStop(0, '#ff3d6a');
    gr.addColorStop(1, '#ff9a5a');
    g.fillStyle = gr;
    g.fillRect(bx, by, bw * f, bh);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(bx, by, bw * f, bh * 0.4);
    // slanted lead lines every 20 health turn the bar into a row of glass pieces
    g.strokeStyle = LEAD;
    g.lineWidth = 2;
    g.beginPath();
    for (let v = 20; v < st.maxHp; v += 20) {
      const sx = bx + (v / st.maxHp) * bw;
      g.moveTo(sx + 4, by); g.lineTo(sx - 4, by + bh);
    }
    g.stroke();
    g.lineWidth = 2.5;
    g.strokeRect(bx, by, bw, bh);
    label(g, `${Math.ceil(p.hp)} / ${st.maxHp}`, bx + bw / 2, by + bh / 2 + 0.5, 13, '#ffffff', 'center', 800);

    const df = p.dashCd > 0 ? 1 - p.dashCd / p.dashMax : 1;
    g.fillStyle = '#16233a';
    g.fillRect(bx, by + 30, 96, 8);
    g.fillStyle = df >= 1 ? '#6ff0ff' : '#3a8fb0';
    g.fillRect(bx, by + 30, 96 * df, 8);
    g.lineWidth = 2;
    g.strokeRect(bx, by + 30, 96, 8);
    label(g, 'рывок', bx + 104, by + 34.5, 10.5, df >= 1 ? '#bff6ff' : '#8a93a8');
    let ox = bx + 156;
    if (p.buffs.rage > 0) {
      icon(g, 'pepper', ox, by + 34, 18);
      label(g, Math.ceil(p.buffs.rage) + ' с', ox + 12, by + 34.5, 11, '#ffb08a');
      ox += 46;
    }
    if (p.buffs.frost > 0) {
      icon(g, 'frost', ox, by + 34, 18);
      label(g, Math.ceil(p.buffs.frost) + ' с', ox + 12, by + 34.5, 11, '#d9ccff');
    }
  }

  resources(g, game, H) {
    const kinds = ['essence', 'wood', 'ore', 'crystal'], x = 16, y = H - 56, cw = 80;
    pane(g, x, y, cw * 4 + 12, 40);
    kinds.forEach((k, i) => {
      icon(g, k, x + 22 + i * cw, y + 20, 22);
      label(g, String(game.inv[k]), x + 37 + i * cw, y + 21, 14);
    });
  }

  // Seeds (F plants, Q switches) on the first row, harvested food with its hotkeys on the second.
  farm(g, game, W, H) {
    const p = game.player, inv = game.inv, w = 306, x = W - w - 16, y = H - 96;
    pane(g, x, y, w, 80);
    keycap(g, 'F', x + 20, y + 21);
    label(g, 'сеять', x + 36, y + 21.5, 11.5, '#cfd6e6');
    let cx = x + 98;
    for (const id of CROP_IDS) {
      const c = CROPS[id], n = inv[c.seed];
      if (p.seedSel === id) pane(g, cx - 15, y + 7, 54, 28, 5, 'rgba(255,210,122,0.2)', '#ffd27a', 2);
      g.globalAlpha = n > 0 ? 1 : 0.4;
      icon(g, c.seed, cx, y + 21, 20);
      label(g, String(n), cx + 13, y + 21.5, 13);
      g.globalAlpha = 1;
      cx += 58;
    }
    keycap(g, 'Q', x + w - 22, y + 21);
    cx = x + 20;
    for (const id of CROP_IDS) {
      const c = CROPS[id], n = inv[c.item];
      keycap(g, c.key, cx, y + 58, n > 0);
      g.globalAlpha = n > 0 ? 1 : 0.4;
      icon(g, c.item, cx + 28, y + 58, 22);
      label(g, String(n), cx + 43, y + 58.5, 13);
      g.globalAlpha = 1;
      cx += 96;
    }
  }

  weapons(g, game, W, H) {
    const p = game.player, n = WEAPONS.length, sw = 46, gap = 7, x0 = W / 2 - (n * sw + (n - 1) * gap) / 2, y0 = H - 62;
    for (let i = 0; i < n; i++) {
      const w = WEAPONS[i], x = x0 + i * (sw + gap), have = !!game.unlocked[w.id], sel = p.weapon === i, y = y0 - (sel ? 5 : 0);
      pane(g, x, y, sw, sw, 7, sel ? 'rgba(44,38,84,0.96)' : GLASS, sel ? w.color : LEAD, sel ? 3 : 2.5);
      g.globalAlpha = have ? 1 : 0.25;
      icon(g, 'weapon:' + w.id, x + sw / 2, y + sw / 2 + 2, 30);
      g.globalAlpha = 1;
      label(g, String(i + 1), x + 9, y + 10, 10.5, have ? '#ffffff' : '#7d7890');
      if (!have && game.canCraft(w.id)) label(g, '!', x + sw - 10, y + 11, 15, '#ffd27a', 'center', 900);
    }
    label(g, WEAPONS[p.weapon].name, W / 2, y0 - 20, 12.5, WEAPONS[p.weapon].color, 'center');
  }

  minimap(g, game, W) {
    const p = game.player, world = game.world, mini = this.mini, R = 76, cx = W - R - 20, cy = R + 20, k = R / MINI_RANGE;
    // The terrain never changes, so the texture is only rebuilt once the player has walked far enough.
    if (mini.world !== world || Math.abs(p.x - mini.cx) > MINI_RANGE * 0.3 || Math.abs(p.y - mini.cy) > MINI_RANGE * 0.3) {
      mini.render(world, p.x, p.y, MINI_RANGE * 1.4);
    }
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.clip();
    g.imageSmoothingEnabled = false;
    const half = mini.range * k;
    g.drawImage(mini.canvas, cx + (mini.cx - p.x) * k - half, cy + (mini.cy - p.y) * k - half, half * 2, half * 2);
    g.imageSmoothingEnabled = true;
    if (game.darkness > 0.02) {
      g.fillStyle = `rgba(10,12,40,${game.darkness * 0.45})`;
      g.fillRect(cx - R, cy - R, R * 2, R * 2);
    }
    for (const m of game.mobs) {
      const dx = (m.x - p.x) * k, dy = (m.y - p.y) * k;
      if (dx * dx + dy * dy > R * R) continue;
      g.fillStyle = m.elite ? '#ffd666' : '#ff4a5a';
      g.fillRect(cx + dx - 1.5, cy + dy - 1.5, 3, 3);
    }
    g.restore();
    g.lineWidth = 4;
    g.strokeStyle = LEAD;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255,226,160,0.55)';
    g.beginPath();
    g.arc(cx, cy, R - 3, 0, TAU);
    g.stroke();
    // Landmarks out of range slide to the rim and become arrows.
    const mark = (wx, wy, color, faded) => {
      let dx = (wx - p.x) * k, dy = (wy - p.y) * k;
      const d = Math.hypot(dx, dy);
      g.globalAlpha = faded ? 0.5 : 1;
      if (d > R - 9) arrowMark(g, cx + (dx / d) * (R - 2), cy + (dy / d) * (R - 2), Math.atan2(dy, dx), 8, color);
      else diamondMark(g, cx + dx, cy + dy, 7, color);
      g.globalAlpha = 1;
    };
    mark(0, 0, '#ffe27a', false);
    for (const l of world.lairs) mark(l.x, l.y, BOSSES[l.id].color, !!game.bossKills[l.id]);
    arrowMark(g, cx, cy, p.aim, 7, '#ffffff');

    const night = game.darkness > 0.5;
    label(g, BIOMES[BIOME_IDS[p.biome]].name, cx, cy + R + 17, 13, '#ffffff', 'center');
    label(g, `День ${game.day} · ${night ? 'ночь' : game.darkness > 0.02 ? 'сумерки' : 'день'}`, cx, cy + R + 34, 11, night ? '#aab6ff' : '#ffe9b0', 'center');
  }

  bossBar(g, game, W) {
    const b = game.boss;
    if (!b) return;
    const w = Math.min(520, W * 0.44), x = W / 2 - w / 2, y = 20, f = clamp(b.hp / b.maxHp, 0, 1), by = y + 24;
    pane(g, x - 12, y - 6, w + 24, 58);
    label(g, `${b.name} — ${b.def.title}${b.lvl ? ` ×${b.lvl + 1}` : ''}`, W / 2, y + 9, 14, b.def.color, 'center', 800);
    g.fillStyle = '#241426';
    g.fillRect(x, by, w, 18);
    g.fillStyle = b.def.color;
    g.fillRect(x, by, w * f, 18);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x, by, w * f, 7);
    g.strokeStyle = LEAD;
    g.lineWidth = 2;
    g.beginPath();
    for (const ph of b.def.phases) { g.moveTo(x + w * ph + 4, by); g.lineTo(x + w * ph - 4, by + 18); }
    g.stroke();
    g.lineWidth = 2.5;
    g.strokeRect(x, by, w, 18);
  }

  toasts(g, list, W, y) {
    for (const t of list) {
      g.globalAlpha = clamp(Math.min(t.age / 0.25, (t.life - t.age) / 0.5), 0, 1);
      g.font = `700 14px ${FONT}`;
      const w = g.measureText(t.text).width + 36;
      pane(g, W / 2 - w / 2, y, w, 30, 8, GLASS, TONES[t.tone] || LEAD, 2.5);
      label(g, t.text, W / 2, y + 15.5, 14, '#ffffff', 'center');
      y += 36;
    }
    g.globalAlpha = 1;
  }

  prompt(g, game, W, H, hint) {
    const pr = game.prompt, y = H - 118;
    if (!pr) {
      if (hint) label(g, hint, W / 2, y, 13, '#f4f0ff', 'center', 600);
      return;
    }
    g.font = `700 14px ${FONT}`;
    const w = g.measureText(pr.text).width + 62, x = W / 2 - w / 2;
    pane(g, x, y - 16, w, 32, 8);
    keycap(g, pr.key, x + 22, y);
    label(g, pr.text, x + 42, y + 0.5, 14);
    if (pr.progress !== undefined) {
      g.fillStyle = '#ffe9b0';
      g.fillRect(x + 8, y + 11, (w - 16) * clamp(pr.progress, 0, 1), 3);
    }
  }

  crosshair(g, game, x, y) {
    const color = WEAPONS[game.player.weapon].color;
    g.save();
    g.translate(x, y);
    g.rotate(performance.now() / 1300);
    g.lineWidth = 1.5;
    g.strokeStyle = LEAD;
    g.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      g.rotate(TAU / 4);
      g.beginPath();
      g.moveTo(6, 0); g.lineTo(13, -3.5); g.lineTo(17, 0); g.lineTo(13, 3.5);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.restore();
    g.beginPath();
    g.arc(x, y, 2, 0, TAU);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 1.2;
    g.stroke();
  }

  worldMap(g, game, W, H) {
    const p = game.player, world = game.world, big = this.big;
    // The map always shows every lair; it only grows when the player wanders further out.
    const range = Math.max(15500, Math.ceil((Math.hypot(p.x, p.y) * 1.15) / 2000) * 2000);
    if (big.world !== world || big.range !== range) big.render(world, 0, 0, range);
    g.fillStyle = 'rgba(8,6,18,0.74)';
    g.fillRect(0, 0, W, H);
    const size = Math.min(W - 60, H - 150), x = W / 2 - size / 2, y = H / 2 - size / 2 + 8, k = size / (range * 2);
    pane(g, x - 14, y - 50, size + 28, size + 98, 14);
    label(g, 'Карта мира', x, y - 26, 20, '#ffe9b0', 'left', 800);
    label(g, 'M или Esc — закрыть', x + size, y - 26, 12, '#aeb6cc', 'right', 600);
    g.imageSmoothingEnabled = false;
    g.drawImage(big.canvas, x, y, size, size);
    g.imageSmoothingEnabled = true;
    g.lineWidth = 3;
    g.strokeStyle = LEAD;
    g.strokeRect(x, y, size, size);
    const px = (wx) => x + size / 2 + wx * k, py = (wy) => y + size / 2 + wy * k;
    diamondMark(g, px(0), py(0), 9, '#ffe27a');
    label(g, 'Маяк', px(0), py(0) - 17, 12, '#ffe9b0', 'center');
    for (const l of world.lairs) {
      const def = BOSSES[l.id], kills = game.bossKills[l.id] || 0;
      diamondMark(g, px(l.x), py(l.y), 10, def.color);
      label(g, def.name + (kills ? ' ✓' : ''), px(l.x), py(l.y) - 18, 12.5, kills ? '#b6ff8a' : '#ffffff', 'center');
      label(g, def.title, px(l.x), py(l.y) + 18, 10, '#d6dcf0', 'center', 600);
    }
    arrowMark(g, clamp(px(p.x), x + 8, x + size - 8), clamp(py(p.y), y + 8, y + size - 8), p.aim, 9, '#ffffff');
    let lx = x;
    for (let i = 0; i < BIOME_IDS.length; i++) {
      const c = MAP_COL[i], name = BIOMES[BIOME_IDS[i]].name;
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      g.fillRect(lx, y + size + 18, 13, 13);
      g.lineWidth = 2;
      g.strokeRect(lx, y + size + 18, 13, 13);
      label(g, name, lx + 19, y + size + 25, 12);
      lx += g.measureText(name).width + 40;
    }
  }
}
