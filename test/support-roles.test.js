import test from 'node:test';
import assert from 'node:assert/strict';
import * as crafter from '../src/roles/crafter.js';
import * as scout from '../src/roles/scout.js';
import { blueprintNeeds } from '../src/blueprint.js';
import { Vec3 } from '../src/world.js';

const view = over => ({ inv: {}, lowHealth: false, full: false, storageExists: true, angle: 0,
  storage: { contents: {}, age: 0 }, need: blueprintNeeds(), furnaceNear: false, sand: null, knownSand: null, ...over });

test('crafter checks storage before deciding and waits when there is none', () => {
  assert.equal(crafter.decide(view({ storageExists: false })).type, 'wait');
  assert.equal(crafter.decide(view({ storage: null })).type, 'inspect_storage');
  assert.equal(crafter.decide(view({ storage: { contents: {}, age: 60_000 } })).type, 'inspect_storage');
});

test('crafter prioritises the door, then glass, then stairs, without spending logs the house needs', () => {
  // 8 logs are all reserved for corner posts, so nothing can be made from them.
  assert.equal(crafter.decide(view({ storage: { contents: { oak_log: 8 }, age: 0 } })).type, 'wait');
  const door = crafter.decide(view({ storage: { contents: { oak_planks: 12 }, age: 0 } }));
  assert.deepEqual([door.type, door.item], ['make', 'door']);
  const noDoorNeeded = { ...blueprintNeeds(), door: 0 };
  const panes = crafter.decide(view({ need: noDoorNeeded, storage: { contents: { oak_planks: 12, glass: 6 }, age: 0 } }));
  assert.equal(panes.item, 'glass_pane');
  const stairs = crafter.decide(view({ need: { stairs: 1 }, storage: { contents: { oak_planks: 6 }, age: 0 } }));
  assert.equal(stairs.item, 'stairs');
  const stoneStairs = crafter.decide(view({ need: { stairs: 1 }, storage: { contents: { cobblestone: 6 }, age: 0 } }));
  assert.equal(stoneStairs.item, 'cobblestone_stairs');
});

test('crafter smelts sand into glass, or goes to find sand', () => {
  const need = { glass_pane: 2 };
  const smelt = crafter.decide(view({ need, storage: { contents: { sand: 6, cobblestone: 8, oak_planks: 4 }, age: 0 } }));
  assert.equal(smelt.type, 'smelt_glass');
  assert.ok(smelt.inputs.some(i => i.group === 'cobblestone'), 'needs cobblestone for a furnace');
  const dig = crafter.decide(view({ need, furnaceNear: true, sand: new Vec3(1, 62, 1), storage: { contents: { oak_planks: 4 }, age: 0 } }));
  assert.equal(dig.type, 'mine');
  const travel = crafter.decide(view({ need, furnaceNear: true, knownSand: [40, 62, 3], storage: { contents: {}, age: 0 } }));
  assert.equal(travel.type, 'travel');
});

test('crafter converts only surplus logs into missing planks', () => {
  const plan = crafter.decide(view({ need: { planks: 45, log: 8 }, storage: { contents: { oak_log: 10 }, age: 0 } }));
  assert.deepEqual([plan.item, plan.count], ['planks', 8]);
});

test('scout reports unseen resources once, then keeps exploring', () => {
  const sighting = { kind: 'Sand', position: new Vec3(20, 62, -5) };
  const v = { lowHealth: false, sightings: [sighting], reported: new Set(), step: 0, waypoint: { x: 24, z: -24 } };
  assert.equal(scout.decide(v).type, 'announce');
  v.reported.add(scout.regionOf('Sand', sighting.position));
  assert.equal(scout.decide(v).type, 'scout_move');
});

test('scout spiral visits every ring position once per cycle and spreads outward', () => {
  const seen = new Set();
  const perCycle = 4 * scout.MAX_RING * (scout.MAX_RING + 1);
  for (let i = 0; i < perCycle; i++) {
    const { x, z } = scout.waypointOffset(i);
    seen.add(`${x},${z}`);
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) <= scout.MAX_RING * scout.SPACING);
  }
  assert.equal(seen.size, perCycle);
  assert.deepEqual(scout.waypointOffset(perCycle), scout.waypointOffset(0));
  assert.equal(Math.max(...Object.values(scout.waypointOffset(0)).map(Math.abs)), scout.SPACING);
});
