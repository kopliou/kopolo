import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { World } from '../src/world.js';
import { BIOME_IDS, BIOME_MOBS, CROPS, DAY_LENGTH, WEAPONS } from '../src/config.js';

const DT = 1 / 30;

function step(g, seconds, each) {
  for (let t = 0; t < seconds; t += DT) {
    if (each) each(g);
    g.update(DT);
    g.events.length = 0;
  }
}

function assertFinite(g) {
  const p = g.player;
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.hp), 'player');
  for (const m of g.mobs) assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.hp), m.type);
  for (const b of g.ebullets) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'enemy bullet');
  for (const b of g.bullets) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'bullet');
}

// Keeps the player alive and firing at the closest enemy while strafing around it.
function bot(g, target) {
  const p = g.player, t = target || g.nearestEnemy(p.x, p.y, 700);
  p.hp = g.st.maxHp;
  g.input.fire = true;
  if (!t) return;
  const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1, f = d > 320 ? 1 : d < 220 ? -1 : 0;
  g.input.aimX = t.x; g.input.aimY = t.y;
  g.input.mx = (dx / d) * f - (dy / d) * 0.7;
  g.input.my = (dy / d) * f + (dx / d) * 0.7;
}

test('world generation is deterministic and offers every biome', () => {
  const a = new World(1234), b = new World(1234), c = new World(99);
  const seen = new Set();
  let differs = 0;
  for (let y = -14000; y <= 14000; y += 700) {
    for (let x = -14000; x <= 14000; x += 700) {
      const v = a.biomeAt(x, y);
      assert.equal(v, b.biomeAt(x, y));
      seen.add(v);
      if (v !== c.biomeAt(x, y)) differs++;
    }
  }
  assert.equal(seen.size, BIOME_IDS.length);
  assert.ok(differs > 0, 'another seed gives another world');
  assert.equal(a.biomeIdx(0, 0), 0, 'the beacon stands in the meadow');
  for (const l of a.lairs) {
    assert.equal(a.biomeIdx(l.x, l.y), l.biome, `${l.id} lair biome`);
    assert.equal(a.liquidAt(l.x, l.y), false);
  }
  const nodes = (w) => w.getChunk(3, -2).nodes.map((n) => [n.type, n.x, n.y]);
  assert.deepEqual(nodes(a), nodes(b));
});

test('shooting kills creatures; loot buys upgrades and weapons', () => {
  const g = new Game({ seed: 7 }), p = g.player;
  p.x = 900; p.y = 0;
  const m = g.spawnMob('slime', 1150, 0);
  step(g, 8, () => { p.hp = 100; g.input.fire = true; g.input.aimX = m.x; g.input.aimY = m.y; });
  assert.ok(m.dead, 'slime dies');
  assert.equal(g.stats.kills >= 1, true);
  g.input.fire = false;
  g.mobs.length = 0;
  for (const k of [...g.pickups]) { p.x = k.x; p.y = k.y; step(g, 0.5); }
  assert.ok(g.inv.essence >= 2, 'essence collected');

  g.inv.essence = 1000;
  assert.ok(g.buyUpgrade('hp'));
  assert.equal(g.derived().maxHp, 120);
  assert.ok(g.inv.essence < 1000);
  assert.equal(g.craft('fan'), false, 'not enough materials');
  g.inv.wood = 100; g.inv.ore = 100; g.inv.crystal = 100;
  assert.ok(g.craft('fan'));
  assert.equal(WEAPONS[p.weapon].id, 'fan');
  assert.equal(g.craft('prism'), false, 'needs a guardian core');
  g.cores.forest = true;
  assert.ok(g.craft('prism'));
});

test('shooting a resource node breaks it into loot and it grows back later', () => {
  const g = new Game({ seed: 7 }), p = g.player, w = g.world;
  let node = null;
  for (let cx = 1; cx < 8 && !node; cx++) node = w.getChunk(cx, 0).nodes.find((n) => n.type === 'tree') || null;
  assert.ok(node, 'a tree grows near the beacon');
  p.x = node.x - 150; p.y = node.y;
  for (let t = 0; t < 12 && node.deadUntil <= g.time; t += DT) {
    p.hp = 100;
    g.input.fire = true; g.input.aimX = node.x; g.input.aimY = node.y;
    g.update(DT);
  }
  assert.ok(node.deadUntil > g.time, 'the tree is felled');
  assert.equal(w.nodeHit(node.x - 5, node.y, node.x + 5, node.y, 2, false), null, 'a felled tree no longer blocks shots');
  g.input.fire = false;
  g.mobs.length = 0;
  for (const k of g.pickups.filter((x) => x.kind === 'wood')) { p.x = k.x; p.y = k.y; step(g, 0.5); }
  assert.ok(g.inv.wood >= 2, 'wood collected');

  p.x = 0; p.y = 70; // wait in the safe zone
  step(g, node.def.respawn + 1);
  assert.ok(node.deadUntil <= g.time, 'the tree grew back');
  assert.equal(node.hp, node.def.hp);
});

test('seeds are planted, ripen over time and yield produce plus new seeds', () => {
  const g = new Game({ seed: 7 }), p = g.player;
  p.x = 0; p.y = 200;
  g.input.aimX = 100; g.input.aimY = 200;
  g.input.plant = true;
  g.update(DT);
  assert.equal(g.crops.size, 1);
  assert.equal(g.inv.seedBerry, 2);
  const crop = [...g.crops.values()][0];
  assert.ok(g.cropProgress(crop) < 0.1);
  g.input.plant = true;
  g.update(DT);
  assert.equal(g.crops.size, 1, 'a tile holds a single crop');

  step(g, CROPS.berry.grow * 1.2);
  assert.equal(g.cropProgress(crop), 1);
  p.x = crop.x; p.y = crop.y;
  g.update(DT);
  assert.equal(g.prompt.key, 'E');
  g.input.interact = true;
  step(g, 3);
  assert.equal(g.crops.size, 0);
  assert.ok(g.inv.berry >= 4, 'berries harvested');
  assert.ok(g.inv.seedBerry >= 3, 'seeds returned');

  p.x = 2000; p.y = 0; p.hp = 30;
  g.input.eat = 'berry';
  g.update(DT);
  assert.ok(p.hp >= 69 && p.hp <= 71);
});

test('every guardian can be woken and defeated, granting its core', () => {
  for (const lair of new World(7).lairs) {
    const g = new Game({ seed: 7 }), p = g.player;
    g.upg.dmg = 10; g.upg.rate = 8;
    p.x = lair.x; p.y = lair.y + 60;
    g.update(DT);
    assert.equal(g.prompt && g.prompt.key, 'E', lair.id);
    g.input.interact = true;
    g.update(DT);
    const boss = g.boss;
    assert.ok(boss, `${lair.id} summoned`);
    let t = 0, phases = 1, shots = 0;
    while (g.boss && t < 600) {
      bot(g, boss);
      g.update(DT);
      assertFinite(g);
      phases = Math.max(phases, boss.phase);
      shots = Math.max(shots, g.ebullets.length + g.hazards.length);
      g.events.length = 0;
      t += DT;
    }
    assert.equal(g.boss, null, `${lair.id} defeated`);
    assert.ok(g.cores[lair.id]);
    assert.equal(g.bossKills[lair.id], 1);
    assert.equal(phases, boss.def.phases.length + 1, `${lair.id} went through its phases`);
    assert.ok(shots > 10, `${lair.id} attacks`);
    assert.equal(g.won, lair.id === 'volcano');
    assert.ok(g.pickups.some((k) => k.kind === 'essence'));
  }
});

test('each biome spawns its own creatures, day and night, without numeric drift', () => {
  const lairs = new World(42).lairs;
  const spots = [{ x: 0, y: 1100, biome: 0 }, ...lairs.map((l) => ({ x: l.x + 620, y: l.y, biome: l.biome }))];
  for (const s of spots) {
    const g = new Game({ seed: 42 }), p = g.player;
    p.x = s.x; p.y = s.y;
    g.time = DAY_LENGTH * 0.66; // dusk into night
    const seen = new Set();
    step(g, 75, () => {
      bot(g);
      // hold position around the spot so the biome stays the same
      g.input.mx += (s.x - p.x) / 300; g.input.my += (s.y - p.y) / 300;
      for (const m of g.mobs) seen.add(m.type);
    });
    assertFinite(g);
    assert.ok(g.darkness > 0.9, 'night fell');
    assert.ok(g.stats.kills > 0, `${BIOME_IDS[s.biome]}: kills`);
    const roster = BIOME_MOBS[BIOME_IDS[s.biome]].map(([id]) => id);
    assert.ok(roster.some((id) => seen.has(id)), `${BIOME_IDS[s.biome]}: saw ${[...seen]}`);
  }
});

test('death costs essence and returns the player to the beacon', () => {
  const g = new Game({ seed: 3 }), p = g.player;
  p.x = 1500; p.y = 0; p.invuln = 0;
  g.inv.essence = 100;
  g.hurtPlayer(500, 0, 0);
  assert.equal(p.alive, false);
  assert.equal(g.inv.essence, 75);
  step(g, 1);
  g.respawn();
  assert.equal(p.alive, true);
  assert.ok(Math.hypot(p.x, p.y) < 200);
  assert.equal(p.hp, g.derived().maxHp);
});

test('a save restores progress and planted crops', () => {
  const g = new Game({ seed: 5 }), p = g.player;
  p.y = 200; // planting right on top of the beacon is not allowed
  g.input.aimX = 200; g.input.aimY = p.y;
  g.input.plant = true;
  step(g, 2);
  g.inv.essence = 77; g.upg.dmg = 2; g.unlocked.fan = true; g.cores.forest = true; g.bossKills.forest = 2;
  p.x = 640; p.y = -320; p.hp = 55; p.weapon = 1;
  const h = new Game({ save: JSON.parse(JSON.stringify(g.serialize())) });
  assert.equal(h.seed, 5);
  assert.deepEqual(h.inv, g.inv);
  assert.deepEqual(h.upg, g.upg);
  assert.deepEqual([h.player.x, h.player.y, h.player.hp, h.player.weapon], [640, -320, 55, 1]);
  assert.equal(h.crops.size, 1);
  assert.equal(h.bossKills.forest, 2);
  assert.equal(h.time, g.time);
  assert.deepEqual(h.world.lairs, g.world.lairs);
});
