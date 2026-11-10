// Tuning tables shared by the simulation and the renderer. No DOM access here.

export const TILE = 48;
export const CHUNK_TILES = 12;
export const CHUNK = TILE * CHUNK_TILES;

export const DAY_LENGTH = 300; // seconds per day/night cycle
export const HOME_RADIUS = 360; // safe zone around the beacon at the origin
export const ARENA_RADIUS = 440;
export const RECALL_TIME = 2.2;

export const BIOME_IDS = ['meadow', 'forest', 'desert', 'tundra', 'volcano'];

export const BIOMES = {
  meadow: { name: 'Луга', map: [79, 174, 82], crop: 'berry' },
  forest: { name: 'Чаща', map: [31, 107, 85], crop: 'berry' },
  desert: { name: 'Пески', map: [224, 160, 60], crop: 'pepper' },
  tundra: { name: 'Стужа', map: [185, 220, 238], crop: 'frost' },
  volcano: { name: 'Пепелище', map: [96, 28, 38], crop: 'pepper' },
};

export const ITEMS = {
  essence: { name: 'Эссенция', color: '#c79bff' },
  wood: { name: 'Древесина', color: '#d19a5b' },
  ore: { name: 'Руда', color: '#c3cae0' },
  crystal: { name: 'Кристаллы', color: '#6ff0ff' },
  seedBerry: { name: 'Семена светоягоды', color: '#8ef5ff' },
  seedPepper: { name: 'Семена огнеперца', color: '#ff8a4a' },
  seedFrost: { name: 'Семена морозника', color: '#c9b5ff' },
  berry: { name: 'Светоягода', color: '#8ef5ff' },
  pepper: { name: 'Огнеперец', color: '#ff6a3a' },
  frost: { name: 'Морозник', color: '#c9b5ff' },
  heart: { name: 'Искра жизни', color: '#ff5d7a' },
};

// `core` names the guardian whose core is required to craft the weapon.
export const WEAPONS = [
  { id: 'shard', name: 'Осколок', desc: 'Надёжный одиночный выстрел', rate: 5.5, dmg: 11, speed: 900, spread: 0.035, life: 0.75, r: 5, color: '#8ef5ff' },
  { id: 'fan', name: 'Веер', desc: 'Шесть осколков веером — для ближнего боя', rate: 1.5, dmg: 9, count: 6, arc: 0.52, speed: 780, life: 0.4, r: 5, color: '#ffd27a', cost: { wood: 25, ore: 10 } },
  { id: 'needle', name: 'Игла', desc: 'Скорострельный поток игл', rate: 13, dmg: 5.5, speed: 1000, spread: 0.1, life: 0.6, r: 4, color: '#b6ff8a', cost: { ore: 30, crystal: 8 } },
  { id: 'prism', name: 'Призма', desc: 'Луч, пробивающий всё насквозь', rate: 1.7, dmg: 38, speed: 1500, life: 0.6, r: 6, pierce: true, color: '#f0a6ff', cost: { crystal: 20 }, core: 'forest' },
  { id: 'comet', name: 'Комета', desc: 'Взрывной заряд по площади', rate: 1.1, dmg: 55, speed: 560, life: 1.0, r: 9, explode: 100, color: '#ff9a5a', cost: { ore: 40, crystal: 20 }, core: 'desert' },
  { id: 'swarm', name: 'Рой', desc: 'Три самонаводящихся осколка', rate: 2.6, dmg: 12, count: 3, arc: 0.7, speed: 520, life: 1.6, r: 5, homing: 6, color: '#8fb4ff', cost: { wood: 40, crystal: 40 }, core: 'tundra' },
];

// Essence cost of the next level is base * grow^level.
export const UPGRADES = [
  { id: 'hp', name: 'Живучесть', desc: '+20 к здоровью', max: 10, base: 20, grow: 1.5 },
  { id: 'dmg', name: 'Мощь', desc: '+12% урона', max: 10, base: 25, grow: 1.55 },
  { id: 'rate', name: 'Темп', desc: '+8% скорострельности', max: 8, base: 30, grow: 1.6 },
  { id: 'speed', name: 'Проворство', desc: '+5% скорости бега', max: 6, base: 25, grow: 1.6 },
  { id: 'magnet', name: 'Притяжение', desc: '+35% радиуса сбора', max: 5, base: 15, grow: 1.6 },
  { id: 'dash', name: 'Рывок', desc: '−12% перезарядки рывка', max: 5, base: 30, grow: 1.6 },
  { id: 'regen', name: 'Регенерация', desc: '+0,5 здоровья в секунду', max: 5, base: 40, grow: 1.7 },
];

// Crops ripen 40% faster in the biomes they like.
export const CROPS = {
  berry: { name: 'Светоягода', seed: 'seedBerry', item: 'berry', grow: 50, likes: ['meadow', 'forest'], use: 'лечит 40 здоровья', key: 'Z', color: '#8ef5ff' },
  pepper: { name: 'Огнеперец', seed: 'seedPepper', item: 'pepper', grow: 70, likes: ['desert', 'volcano'], use: '+40% урона на 30 с', key: 'X', color: '#ff6a3a' },
  frost: { name: 'Морозник', seed: 'seedFrost', item: 'frost', grow: 70, likes: ['tundra'], use: '−40% получаемого урона и +15% скорости на 30 с', key: 'C', color: '#c9b5ff' },
};

// r is the collision radius, vr the drawn radius; drops are [item, min, max].
export const NODES = {
  tree: { hp: 40, r: 17, vr: 31, solid: true, respawn: 80, drops: [['wood', 2, 4]], color: '#4fc46a' },
  pine: { hp: 50, r: 16, vr: 30, solid: true, respawn: 80, drops: [['wood', 3, 5]], color: '#2c9c7c' },
  bush: { hp: 14, r: 13, vr: 16, solid: false, respawn: 60, drops: [['seedBerry', 1, 2]], color: '#8fd35a' },
  rock: { hp: 70, r: 19, vr: 23, solid: true, respawn: 110, drops: [['ore', 2, 4]], color: '#9aa0b8' },
  crystal: { hp: 55, r: 15, vr: 26, solid: true, respawn: 150, drops: [['crystal', 1, 3]], color: '#6ff0ff', glow: '#6ff0ff' },
  cactus: { hp: 35, r: 14, vr: 18, solid: true, respawn: 80, drops: [['wood', 1, 3]], color: '#5fbf6a' },
  bloom: { hp: 14, r: 13, vr: 16, solid: false, respawn: 60, drops: [['seedPepper', 1, 2]], color: '#ff5a6a' },
  snowpine: { hp: 50, r: 16, vr: 30, solid: true, respawn: 80, drops: [['wood', 3, 5]], color: '#bfe6f2' },
  ice: { hp: 60, r: 16, vr: 27, solid: true, respawn: 130, drops: [['crystal', 2, 3]], color: '#c8f4ff', glow: '#9fe8ff' },
  frostbush: { hp: 14, r: 13, vr: 16, solid: false, respawn: 60, drops: [['seedFrost', 1, 2]], color: '#c9b5ff' },
  obsidian: { hp: 120, r: 20, vr: 25, solid: true, respawn: 120, drops: [['ore', 4, 7]], color: '#7a5aa0' },
  magma: { hp: 90, r: 16, vr: 27, solid: true, respawn: 140, drops: [['crystal', 3, 5]], color: '#ff9a3a', glow: '#ff7a2a' },
  deadtree: { hp: 30, r: 13, vr: 26, solid: true, respawn: 90, drops: [['wood', 2, 3]], color: '#c8b8a4' },
};

// Chance per tile that a node of the given type grows there.
export const BIOME_NODES = {
  meadow: [['tree', 0.035], ['bush', 0.022], ['rock', 0.012], ['crystal', 0.004]],
  forest: [['pine', 0.1], ['tree', 0.04], ['bush', 0.022], ['rock', 0.015], ['crystal', 0.007]],
  desert: [['cactus', 0.03], ['rock', 0.03], ['bloom', 0.014], ['crystal', 0.004]],
  tundra: [['snowpine', 0.035], ['ice', 0.028], ['frostbush', 0.014], ['rock', 0.012]],
  volcano: [['obsidian', 0.04], ['magma', 0.022], ['deadtree', 0.022], ['bloom', 0.006]],
};

export const MOBS = {
  slime: { ai: 'hopper', hp: 26, dmg: 8, speed: 135, r: 15, ess: 2, pack: 2, color: '#ff7aa8' },
  wasp: { ai: 'swooper', hp: 15, dmg: 6, speed: 215, r: 11, ess: 2, pack: 3, flying: true, color: '#ffd23a' },
  spore: { ai: 'shooter', hp: 42, dmg: 9, speed: 85, r: 17, ess: 4, range: 330, fireEvery: 2.0, shot: { n: 1, spread: 0, speed: 250, r: 8, color: '#d98cff' }, color: '#c26bff' },
  wolf: { ai: 'charger', hp: 52, dmg: 13, speed: 165, r: 16, ess: 5, pack: 2, color: '#9a9ae0' },
  scorp: { ai: 'shooter', hp: 72, dmg: 11, speed: 105, r: 18, ess: 7, range: 350, fireEvery: 2.3, shot: { n: 3, spread: 0.2, speed: 320, r: 6, color: '#c86aff' }, color: '#a84068', drops: [['ore', 0.25]] },
  beetle: { ai: 'bomber', hp: 44, dmg: 24, speed: 205, r: 14, ess: 6, pack: 2, color: '#2fa8b8' },
  wisp: { ai: 'orbiter', hp: 62, dmg: 12, speed: 185, r: 14, ess: 8, flying: true, fireEvery: 2.3, color: '#8a7aff', drops: [['crystal', 0.25]] },
  yeti: { ai: 'tank', hp: 280, dmg: 22, speed: 82, r: 27, ess: 18, kb: 0.3, color: '#6a8abc', drops: [['crystal', 0.5]] },
  magmite: { ai: 'chaser', hp: 115, dmg: 16, speed: 150, r: 20, ess: 10, split: 'magmiteS', color: '#ff8a2a', drops: [['ore', 0.3]] },
  magmiteS: { ai: 'chaser', hp: 34, dmg: 10, speed: 205, r: 12, ess: 3, color: '#ffa23a' },
  sentinel: { ai: 'turret', hp: 200, dmg: 13, speed: 55, r: 22, ess: 16, flying: true, kb: 0.4, color: '#e8e0d8', drops: [['crystal', 0.6]] },
};

// Weighted spawn tables per biome.
export const BIOME_MOBS = {
  meadow: [['slime', 3], ['wasp', 2]],
  forest: [['spore', 2], ['wolf', 2], ['slime', 1]],
  desert: [['scorp', 2], ['beetle', 2], ['wasp', 1]],
  tundra: [['wisp', 3], ['yeti', 1], ['wolf', 1]],
  volcano: [['magmite', 3], ['sentinel', 1], ['beetle', 1]],
};

// phases lists the health fractions at which a guardian escalates.
export const BOSSES = {
  forest: { name: 'Корнеглав', title: 'Хранитель Чащи', hp: 1100, r: 46, touch: 16, shot: 11, phases: [0.5], essence: 160, loot: [['wood', 24], ['crystal', 8]], color: '#ff6ad5', color2: '#b8ff5a' },
  desert: { name: 'Зыбун', title: 'Хранитель Песков', hp: 1900, r: 32, touch: 20, shot: 13, slam: 26, phases: [0.5], essence: 320, loot: [['ore', 30], ['crystal', 12]], color: '#b07aff', color2: '#ffd27a' },
  tundra: { name: 'Стужень', title: 'Хранитель Стужи', hp: 3000, r: 54, touch: 22, shot: 14, slam: 28, phases: [0.5], essence: 520, loot: [['crystal', 30], ['ore', 20]], color: '#4a7aff', color2: '#eaffff' },
  volcano: { name: 'Игнис', title: 'Сердце Пепла', hp: 4600, r: 50, touch: 24, shot: 15, slam: 30, laser: 22, phases: [0.66, 0.33], essence: 900, loot: [['crystal', 40], ['ore', 40]], color: '#ff5a2a', color2: '#ffd24a' },
};

// Lairs sit on rings of growing distance, one per quadrant (see World).
export const LAIR_DEFS = [
  { id: 'forest', biome: 1, dist: 3600 },
  { id: 'desert', biome: 2, dist: 6400 },
  { id: 'tundra', biome: 3, dist: 9200 },
  { id: 'volcano', biome: 4, dist: 12500 },
];
