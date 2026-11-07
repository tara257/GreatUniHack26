import test from 'node:test';
import assert from 'node:assert/strict';
import * as miner from '../src/roles/miner.js';
import * as lumberjack from '../src/roles/lumberjack.js';
import * as builder from '../src/roles/builder.js';
import { HOUSE, survey, placeable, requirements, cellKey } from '../src/blueprint.js';
import { helpBuild, craftFromCarried } from '../src/roles/construction.js';
import { Vec3 } from '../src/world.js';

const P = (x, y, z) => new Vec3(x, y, z);
const base = over => ({ inv: {}, lowHealth: false, full: false, storageExists: true, storage: null, angle: 0, ...over });

test('miner without a pickaxe bootstraps one from wood', () => {
  assert.equal(miner.decide(base({ storageExists: false, toolTree: P(1, 64, 1) })).type, 'chop');
  assert.equal(miner.decide(base({ storageExists: false, tree: null, knownWood: [5, 64, 5] })).type, 'travel');
  assert.equal(miner.decide(base({ storageExists: false })).type, 'explore');
  assert.equal(miner.decide(base({ storage: { contents: { oak_log: 4 }, age: 0 } })).type, 'withdraw');
  // Storage recently seen empty: go chop instead of repeatedly checking it.
  assert.equal(miner.decide(base({ storage: { contents: {}, age: 0 }, toolTree: P(1, 64, 1) })).type, 'chop');
  const craft = miner.decide(base({ inv: { oak_log: 3 } }));
  assert.deepEqual([craft.type, craft.item], ['craft_tool', 'wooden_pickaxe']);
});

test('miner mines, upgrades its pickaxe and deposits at the threshold', () => {
  const stone = P(3, 60, 3);
  assert.equal(miner.decide(base({ inv: { wooden_pickaxe: 1, oak_planks: 1 }, stone })).type, 'mine');
  const upgrade = miner.decide(base({ inv: { wooden_pickaxe: 1, cobblestone: 3, stick: 2 }, tableNear: true, stone }));
  assert.equal(upgrade.item, 'stone_pickaxe');
  const deposit = miner.decide(base({ inv: { stone_pickaxe: 1, cobblestone: miner.DEPOSIT_AT }, stone }));
  assert.equal(deposit.type, 'deposit');
  assert.equal(deposit.keep('cobblestone'), 3);
  assert.equal(deposit.keep('stone_pickaxe'), 64);
  assert.equal(deposit.keep('dirt'), 0);
  assert.equal(miner.decide(base({ inv: { stone_pickaxe: 1 }, knownStone: [9, 50, 9] })).type, 'travel');
  assert.equal(miner.decide(base({ inv: { stone_pickaxe: 1 } })).type, 'explore');
  assert.equal(miner.decide(base({ lowHealth: true })).type, 'rest');
});

test('lumberjack chops, then delivers logs, converting to planks once storage has enough logs', () => {
  assert.equal(lumberjack.decide(base({ tree: P(1, 64, 1) })).type, 'chop');
  const full = { oak_log: lumberjack.DEPOSIT_AT };
  const first = lumberjack.decide(base({ inv: full, tree: P(1, 64, 1), storage: { contents: { oak_log: 2 }, age: 0 } }));
  assert.deepEqual([first.type, first.convertLogs], ['deposit', false]);
  const later = lumberjack.decide(base({ inv: full, tree: P(1, 64, 1), storage: { contents: { oak_log: lumberjack.LOG_RESERVE }, age: 0 } }));
  assert.deepEqual([later.type, later.convertLogs], ['deposit', true]);
  // Nothing left nearby: deliver a partial load rather than wandering with it.
  assert.equal(lumberjack.decide(base({ inv: { oak_log: 5 } })).type, 'deposit');
  assert.equal(lumberjack.decide(base({ inv: { oak_log: 1 } })).type, 'explore');
});

function builderView(nameAt, over = {}) {
  const origin = P(100, 64, 200);
  const report = survey(HOUSE, origin, nameAt);
  return base({ origin, report, siteLoaded: true, placeable: placeable(report, origin, nameAt), failed: new Set(), distanceToSite: 5,
    tower: [], fillerTarget: null, siteNeed: requirements(report.missing), shortfall: null, ...over });
}
const flat = (x, y, z) => (y < 64 ? 'grass_block' : 'air');

test('builder clears obstructions before placing', () => {
  const view = builderView((x, y, z) => (x === 101 && y === 65 && z === 201 ? 'short_grass' : flat(x, y, z)), { inv: { cobblestone: 10 } });
  assert.equal(builder.decide(view).type, 'clear');
});

test('builder places held materials and moves to other tasks when one material is missing', () => {
  const place = builder.decide(builderView(flat, { inv: { cobblestone: 5 } }));
  assert.deepEqual([place.type, place.group], ['place', 'cobblestone']);
  // Holding only a door, and the floor is not yet buildable for it: fetch the rest from storage.
  const fetch = builder.decide(builderView(flat, { inv: {} }));
  assert.equal(fetch.type, 'withdraw');
  assert.ok(fetch.wants.some(w => w.group === 'cobblestone' && w.count === 64));
  // Storage was just checked and has only planks: ask only for planks.
  const planksOnly = builder.decide(builderView(flat, { storage: { contents: { oak_planks: 20 }, age: 0 } }));
  assert.deepEqual(planksOnly.wants.map(w => w.group), ['oak_planks']);
  // Storage recently seen empty: wait and say what is needed.
  const wait = builder.decide(builderView(flat, { storage: { contents: {}, age: 0 } }));
  assert.equal(wait.type, 'wait');
  assert.match(wait.say, /128 cobblestone/);
});

test('builder skips cells that recently failed and finishes when the house is complete', () => {
  const view = builderView(flat, { inv: { cobblestone: 5 } });
  const first = builder.decide(view);
  view.failed = new Set([`${first.target.x},${first.target.y},${first.target.z}`]);
  const second = builder.decide(view);
  assert.notDeepEqual(second.target, first.target);
  const done = builder.decide(builderView(flat, { report: { complete: [], missing: [], obstructed: [], supports: [], unknown: [] } }));
  assert.equal(done.type, 'done');
});

test('builder messages report measured progress', () => {
  const view = builderView(flat, { inv: { cobblestone: 5 }, progress: { placed: 10, required: 83, percent: 12 } });
  assert.match(builder.decide(view).say, /house 12%: 10\/83 blocks/);
});

test('builder walks to the site when it is not loaded', () => {
  assert.equal(builder.decide(builderView(flat, { siteLoaded: false })).type, 'travel');
});

// The house built up to (and including) relative layer `top`; everything above is still missing.
const builtTo = top => (x, y, z) => {
  if (y < 64) return 'grass_block';
  const cell = HOUSE.cells.find(c => c.x === x - 100 && c.y === y - 64 && c.z === z - 200);
  if (!cell || cell.y > top || cell.material === 'air') return 'air';
  return cell.material === 'door_upper' ? 'oak_door' : cell.material;
};

test('builder pillars up for roof cells it failed to reach, digging dirt first if it has none', () => {
  const view = builderView(builtTo(3), { inv: { oak_stairs: 30 }, storageExists: false });
  assert.equal(builder.decide(view).type, 'place');
  view.failed = new Set(view.placeable.map(cellKey));
  assert.equal(builder.decide(view).type, 'wait'); // no dirt and none in sight
  view.fillerTarget = P(90, 63, 200);
  assert.equal(builder.decide(view).type, 'mine');
  view.inv.dirt = 6;
  const tower = builder.decide(view);
  assert.equal(tower.type, 'tower_place');
  assert.ok(tower.cells.every(c => c.y === 68 && c.material === 'oak_stairs'));
});

test('cells near the ridge go straight to a pillar without trying to walk there first', () => {
  const kit = { oak_stairs: 30, oak_planks: 20, dirt: 6 };
  // Layer 6 (rel) is reachable standing on the floor; layer 7 and the ridge are not tried by walking.
  assert.equal(builder.decide(builderView(builtTo(5), { inv: kit, storageExists: false })).type, 'place');
  const tower = builder.decide(builderView(builtTo(6), { inv: kit, storageExists: false }));
  assert.equal(tower.type, 'tower_place');
  assert.ok(tower.cells.every(c => c.y >= 71));
});

test('a builder holding planks crafts the stairs the roof still needs', () => {
  const view = builderView(builtTo(3), { inv: { oak_planks: 12 } });
  const make = craftFromCarried({ ...view, report: { ...view.report, missing: view.report.missing.filter(c => c.material === 'oak_stairs') } });
  assert.deepEqual([make.type, make.item, make.count], ['make', 'oak_stairs', 8]);
});

test('builder removes a leftover pillar before anything else', () => {
  assert.equal(builder.decide(builderView(flat, { tower: [[1, 64, 1]], inv: { cobblestone: 5 } })).type, 'dismantle');
});

test('miner and lumberjack stop gathering once the team has enough, and help build instead', () => {
  const site = builderView(flat, { inv: { stone_pickaxe: 1, cobblestone: 2 }, stone: P(3, 60, 3) });
  assert.equal(miner.decide({ ...site, shortfall: { cobblestone: 4, wood: 10 } }).type, 'mine');
  const helping = miner.decide({ ...site, shortfall: { cobblestone: 0, wood: 10 } });
  assert.deepEqual([helping.type, helping.group], ['place', 'cobblestone']);

  const jack = builderView(flat, { tree: P(1, 64, 1) });
  // Only oak is collected: birch carried does not count towards a delivery.
  assert.equal(lumberjack.decide(base({ inv: { birch_log: 20 } })).type, 'explore');
  assert.equal(lumberjack.decide({ ...jack, shortfall: { cobblestone: 0, wood: 3 } }).type, 'chop');
  assert.notEqual(lumberjack.decide({ ...jack, shortfall: { cobblestone: 0, wood: 0 } }).type, 'chop');
  // Holding spare logs while the house still needs planks: convert them first.
  const convert = lumberjack.decide({ ...jack, inv: { oak_log: 12 }, siteNeed: { oak_planks: 45, oak_log: 8 }, shortfall: { cobblestone: 0, wood: 0 } });
  assert.deepEqual([convert.type, convert.count], ['craft_planks', 16]);
});

test('helpers hand over materials they cannot place yet and fetch only what they can place', () => {
  // Floor not started: planks are not placeable, cobblestone is.
  const holdingPlanks = builderView(flat, { inv: { oak_planks: 20, stone_pickaxe: 1 } });
  const handOver = helpBuild(holdingPlanks);
  assert.equal(handOver.type, 'deposit');
  assert.equal(handOver.keep('oak_planks'), 0);
  assert.equal(handOver.keep('stone_pickaxe'), 999);
  const fetch = helpBuild(builderView(flat, { storage: { contents: { oak_planks: 40, cobblestone: 30 }, age: 0 } }));
  assert.deepEqual(fetch.wants.map(w => w.group), ['cobblestone']);
  assert.equal(helpBuild(builderView(flat, { distanceToSite: 80 })).type, 'travel');
  const done = builderView(flat, { report: { complete: [], missing: [], obstructed: [], supports: [], unknown: [] } });
  assert.equal(helpBuild(done).type, 'done');
});
