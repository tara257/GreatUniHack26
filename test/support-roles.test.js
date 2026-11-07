import test from 'node:test';
import assert from 'node:assert/strict';
import * as crafter from '../src/roles/crafter.js';
import * as scout from '../src/roles/scout.js';
import { blueprintNeeds } from '../src/blueprint.js';
import { Vec3 } from '../src/world.js';

const view = over => ({ inv: {}, lowHealth: false, full: false, storageExists: true, angle: 0,
  storage: { contents: {}, age: 0 }, need: blueprintNeeds(), ...over });

test('crafter checks storage before deciding and waits when there is none', () => {
  assert.equal(crafter.decide(view({ storageExists: false })).type, 'wait');
  assert.equal(crafter.decide(view({ storage: null })).type, 'inspect_storage');
  assert.equal(crafter.decide(view({ storage: { contents: {}, age: 60_000 } })).type, 'inspect_storage');
});

test('crafter makes the door first, then fence windows, then roof stairs, from oak only', () => {
  // 18 oak logs are all reserved for the log posts, so nothing can be made from them.
  assert.equal(crafter.decide(view({ storage: { contents: { oak_log: 18 }, age: 0 } })).type, 'wait');
  // Birch is never used for house components.
  assert.equal(crafter.decide(view({ storage: { contents: { birch_planks: 64 }, age: 0 } })).type, 'wait');
  const door = crafter.decide(view({ storage: { contents: { oak_planks: 64 }, age: 0 } }));
  assert.deepEqual([door.type, door.item, door.count, door.returnToStorage], ['make', 'oak_door', 1, true]);
  const fences = crafter.decide(view({ storage: { contents: { oak_planks: 64, oak_door: 1 }, age: 0 } }));
  assert.deepEqual([fences.item, fences.count], ['oak_fence', 13]);
  assert.deepEqual(fences.inputs, [{ group: 'oak_planks', count: 25 }]);
  const stairs = crafter.decide(view({ storage: { contents: { oak_planks: 64, oak_door: 1, oak_fence: 13 }, age: 0 } }));
  assert.deepEqual([stairs.item, stairs.count], ['oak_stairs', crafter.STAIR_BATCH]);
});

test('crafter uses spare oak logs when planks run short, but never the logs the posts need', () => {
  const need = { oak_stairs: 8, oak_log: 18 };
  const fromLogs = crafter.decide(view({ need, storage: { contents: { oak_log: 21 }, age: 0 } }));
  assert.deepEqual([fromLogs.item, fromLogs.count], ['oak_stairs', 8]);
  assert.deepEqual(fromLogs.inputs, [{ group: 'oak_planks', count: 12 }, { group: 'oak_log', count: 3 }]);
});

test('crafter converts only surplus oak logs into missing planks', () => {
  const plan = crafter.decide(view({ need: { oak_planks: 45, oak_log: 8 }, storage: { contents: { oak_log: 10 }, age: 0 } }));
  assert.deepEqual([plan.item, plan.count], ['oak_planks', 8]);
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
