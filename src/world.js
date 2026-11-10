// Deterministic, chunked, endless world: biomes, liquid tiles, resource nodes and guardian lairs.
import { TILE, CHUNK_TILES, CHUNK, BIOME_IDS, NODES, BIOME_NODES, ARENA_RADIUS, LAIR_DEFS } from './config.js';
import { TAU, hash01, hash2, fbm, dist2, segCircle } from './util.js';

const CELL = 2000; // size of a biome region
const HOME_BIOME_R = 1500;
const LAIR_BIOME_R = 1250;
const MAX_NODE_R = 30;
const chunkKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

// Biome weights of a region by its distance from the beacon: the further out, the harsher.
const RINGS = [
  [2600, [[0, 0.65], [1, 0.35]]],
  [5400, [[1, 0.4], [0, 0.22], [2, 0.28], [3, 0.1]]],
  [8600, [[2, 0.34], [3, 0.26], [1, 0.2], [0, 0.1], [4, 0.1]]],
  [Infinity, [[4, 0.34], [3, 0.26], [2, 0.22], [1, 0.18]]],
];

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.now = 0; // game time, set by the simulation; nodes are alive once now >= deadUntil
    this.chunks = new Map();
    this.deadNodes = new Map(); // node id -> deadUntil, for chunks that were pruned
    const a0 = hash01(11, 17, this.seed) * TAU;
    this.lairs = LAIR_DEFS.map((d, i) => {
      const a = a0 + i * (TAU / 4) + (hash01(i, 23, this.seed) - 0.5) * 0.7;
      return { id: d.id, biome: d.biome, x: Math.round(Math.cos(a) * d.dist), y: Math.round(Math.sin(a) * d.dist), r: ARENA_RADIUS };
    });
  }

  // Biome index straight from the noise fields (warped Voronoi regions).
  biomeAt(x, y) {
    const s = this.seed;
    const wx = x + (fbm(x * 0.0015, y * 0.0015, s + 11) - 0.5) * 760;
    const wy = y + (fbm(x * 0.0015 + 37.1, y * 0.0015 - 19.7, s + 12) - 0.5) * 760;
    if (wx * wx + wy * wy < HOME_BIOME_R * HOME_BIOME_R) return 0;
    for (const l of this.lairs) if (dist2(wx, wy, l.x, l.y) < LAIR_BIOME_R * LAIR_BIOME_R) return l.biome;
    const gx = Math.floor(wx / CELL), gy = Math.floor(wy / CELL);
    let best = Infinity, biome = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = gx + i, cy = gy + j;
        const sx = (cx + 0.15 + 0.7 * hash01(cx, cy, s + 21)) * CELL;
        const sy = (cy + 0.15 + 0.7 * hash01(cx, cy, s + 22)) * CELL;
        const d = dist2(wx, wy, sx, sy);
        if (d < best) { best = d; biome = this.siteBiome(cx, cy, sx, sy); }
      }
    }
    return biome;
  }

  siteBiome(cx, cy, sx, sy) {
    const d = Math.hypot(sx, sy), u = hash01(cx, cy, this.seed + 23);
    for (const [limit, table] of RINGS) {
      if (d >= limit) continue;
      let acc = 0;
      for (const [b, p] of table) { acc += p; if (u < acc) return b; }
      return table[0][0];
    }
    return 0;
  }

  liquidRaw(x, y, biome) {
    if (x * x + y * y < 620 * 620) return false;
    for (const l of this.lairs) if (dist2(x, y, l.x, l.y) < (ARENA_RADIUS + 120) ** 2) return false;
    const limit = biome === 4 ? 0.64 : biome === 2 ? 0.74 : 0.69;
    return fbm(x * 0.0042, y * 0.0042, this.seed + 31) > limit;
  }

  // Jittered tile corners: the renderer builds its glass mosaic from them.
  cornerX(i, j) { return (i + (hash01(i, j, this.seed + 41) - 0.5) * 0.54) * TILE; }
  cornerY(i, j) { return (j + (hash01(i, j, this.seed + 42) - 0.5) * 0.54) * TILE; }

  getChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    let c = this.chunks.get(key);
    if (!c) { c = this.genChunk(cx, cy, key); this.chunks.set(key, c); }
    return c;
  }

  genChunk(cx, cy, key) {
    const n = CHUNK_TILES;
    const tiles = new Uint8Array(n * n), liquid = new Uint8Array(n * n);
    const nodes = [], liquidList = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const tx = cx * n + i, ty = cy * n + j;
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        const b = this.biomeAt(x, y);
        tiles[j * n + i] = b;
        if (this.liquidRaw(x, y, b)) { liquid[j * n + i] = 1; liquidList.push(j * n + i); continue; }
        const node = this.nodeFor(tx, ty, b, x, y);
        if (node) nodes.push(node);
      }
    }
    return { key, cx, cy, tiles, liquid, liquidList, nodes };
  }

  nodeFor(tx, ty, biome, x, y) {
    const s = this.seed, h = hash01(tx, ty, s + 51);
    let acc = 0, type = null;
    for (const [t, p] of BIOME_NODES[BIOME_IDS[biome]]) { acc += p; if (h < acc) { type = t; break; } }
    if (!type) return null;
    const nx = x + (hash01(tx, ty, s + 52) - 0.5) * 22, ny = y + (hash01(tx, ty, s + 53) - 0.5) * 22;
    if (nx * nx + ny * ny < 300 * 300) return null; // keep the beacon clearing free for farm plots
    for (const l of this.lairs) if (dist2(nx, ny, l.x, l.y) < (ARENA_RADIUS + 30) ** 2) return null;
    const def = NODES[type], sc = 0.85 + hash01(tx, ty, s + 54) * 0.35, id = tx + ',' + ty;
    return {
      id, type, def, x: nx, y: ny, r: def.r * sc, sc, rot: hash01(tx, ty, s + 55) * TAU, variant: hash2(tx, ty, s + 56) % 3,
      hp: def.hp, deadUntil: this.deadNodes.get(id) || 0, hitAt: -9,
    };
  }

  tileOf(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const cx = Math.floor(tx / CHUNK_TILES), cy = Math.floor(ty / CHUNK_TILES);
    this._chunk = this.getChunk(cx, cy);
    return (ty - cy * CHUNK_TILES) * CHUNK_TILES + (tx - cx * CHUNK_TILES);
  }

  // Tile lookups through the chunk cache (cheaper than biomeAt once a chunk exists).
  biomeIdx(x, y) { const i = this.tileOf(x, y); return this._chunk.tiles[i]; }
  liquidAt(x, y) { const i = this.tileOf(x, y); return this._chunk.liquid[i] === 1; }

  // Calls fn for every living node whose circle overlaps the given circle.
  nodesNear(x, y, r, fn) {
    const pad = r + MAX_NODE_R, now = this.now;
    const cx0 = Math.floor((x - pad) / CHUNK), cx1 = Math.floor((x + pad) / CHUNK);
    const cy0 = Math.floor((y - pad) / CHUNK), cy1 = Math.floor((y + pad) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ns = this.getChunk(cx, cy).nodes;
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i];
          if (n.deadUntil > now) continue;
          const rr = r + n.r, dx = n.x - x, dy = n.y - y;
          if (dx * dx + dy * dy < rr * rr) fn(n);
        }
      }
    }
  }

  // First living node crossed by a moving projectile of radius r, or null.
  nodeHit(x0, y0, x1, y1, r, solidOnly) {
    const pad = r + MAX_NODE_R, now = this.now;
    const cx0 = Math.floor((Math.min(x0, x1) - pad) / CHUNK), cx1 = Math.floor((Math.max(x0, x1) + pad) / CHUNK);
    const cy0 = Math.floor((Math.min(y0, y1) - pad) / CHUNK), cy1 = Math.floor((Math.max(y0, y1) + pad) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ns = this.getChunk(cx, cy).nodes;
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i];
          if (n.deadUntil > now || (solidOnly && !n.def.solid)) continue;
          if (segCircle(x0, y0, x1, y1, n.x, n.y, n.r * 0.85 + r)) return n;
        }
      }
    }
    return null;
  }

  // Forget far-away chunks so an endless walk does not grow memory without bound.
  prune(px, py) {
    if (this.chunks.size < 420) return;
    const pcx = Math.floor(px / CHUNK), pcy = Math.floor(py / CHUNK);
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) <= 7 && Math.abs(c.cy - pcy) <= 7) continue;
      for (const n of c.nodes) if (n.deadUntil > this.now) this.deadNodes.set(n.id, n.deadUntil);
      this.chunks.delete(key);
    }
    for (const [id, t] of this.deadNodes) if (t <= this.now) this.deadNodes.delete(id);
  }
}
