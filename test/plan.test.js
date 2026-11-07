import test from 'node:test';
import assert from 'node:assert/strict';
import { rawShortfall, componentShortfall, componentPlanks } from '../src/plan.js';
import { blueprintNeeds } from '../src/blueprint.js';

test('a fresh site needs cobblestone for the floor and base, and oak for posts, walls, roof and components', () => {
  const s = rawShortfall(blueprintNeeds(), {});
  assert.equal(s.cobblestone, 128);
  // 18 oak logs + ceil((89 planks + door 6 + fences 5 x 5 + stairs 23 x 6) / 4)
  assert.equal(componentPlanks(componentShortfall(blueprintNeeds(), {})), 6 + 25 + 138);
  assert.equal(s.wood, 18 + Math.ceil((89 + 169) / 4));
});

test('only oak counts: birch in storage does not reduce the wood still needed', () => {
  const need = { oak_planks: 40 };
  assert.equal(rawShortfall(need, { birch_planks: 64, birch_log: 20 }).wood, 10);
  assert.equal(rawShortfall(need, { oak_planks: 24, oak_log: 4 }).wood, 0);
});

test('components already made remove their raw cost; placed blocks are no longer needed', () => {
  const need = { oak_planks: 10, oak_door: 1, oak_stairs: 8, oak_fence: 3 };
  assert.equal(rawShortfall(need, { oak_door: 1, oak_stairs: 8, oak_fence: 3, oak_planks: 10 }).wood, 0);
  assert.deepEqual(componentShortfall(need, { oak_stairs: 5 }), { oak_door: 1, oak_fence: 3, oak_stairs: 3 });
  assert.deepEqual(rawShortfall({}, {}), { cobblestone: 0, wood: 0 });
});
