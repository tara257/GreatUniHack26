import test from 'node:test';
import assert from 'node:assert/strict';
import { rawShortfall } from '../src/plan.js';
import { blueprintNeeds } from '../src/blueprint.js';

test('a fresh site needs cobblestone for floor and furnace, and wood for walls, roof, door, stairs and fuel', () => {
  const s = rawShortfall(blueprintNeeds(), {});
  assert.equal(s.cobblestone, 25 + 8);
  // 8 logs + ceil((45 planks + 6 door + 6 stairs + 4 fuel) / 4)
  assert.equal(s.wood, 8 + 16);
});

test('storage and carried items count towards the need, spare logs count as planks', () => {
  const s = rawShortfall(blueprintNeeds(), { cobblestone: 40, oak_log: 24, oak_planks: 0 }, { furnaceNear: false });
  assert.equal(s.cobblestone, 0);
  assert.equal(s.wood, 0); // 16 spare logs = 64 planks >= 61
});

test('components already made remove their raw cost; placed blocks are no longer needed', () => {
  const need = { planks: 10, door: 1, stairs: 1, glass_pane: 2 };
  assert.equal(rawShortfall(need, { oak_door: 1, oak_stairs: 1, glass_pane: 2, oak_planks: 10 }).wood, 0);
  assert.deepEqual(rawShortfall({}, {}), { cobblestone: 0, wood: 0 });
});
