import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE, survey, placeable, requirements, blueprintNeeds, cellKey, progress, parseLayers } from '../src/blueprint.js';

const origin = { x: 100, y: 64, z: 200 };
// A tiny fake world: flat grass below y=64, air above, plus explicit overrides.
function world(overrides = {}) {
  const blocks = new Map(Object.entries(overrides));
  return {
    blocks,
    nameAt: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? (y < 64 ? 'grass_block' : 'air'),
  };
}
const build = (w, cell) => w.blocks.set(cellKey(cell), {
  cobblestone: 'cobblestone', planks: 'oak_planks', log: 'oak_log', door: 'oak_door',
  glass_pane: 'glass_pane', stairs: 'oak_stairs', filler: 'dirt',
}[cell.material]);

test('the blueprint is a closed house with a door, windows and a step', () => {
  assert.deepEqual(blueprintNeeds(), { cobblestone: 25, planks: 45, log: 8, glass_pane: 2, door: 1, stairs: 1 });
  assert.equal(HOUSE.cells.filter(c => c.material === 'air').length, 18);
});

test('an empty flat site needs everything and only the floor centre can start', () => {
  const w = world();
  const report = survey(HOUSE, origin, w.nameAt);
  assert.equal(report.complete.length, 18); // interior air already clear
  assert.equal(report.obstructed.length, 0);
  assert.deepEqual(requirements(report.missing), blueprintNeeds());
  const next = placeable(report, origin, w.nameAt);
  // Floor cells and the step rest on the ground; nothing above floor level is attachable yet.
  assert.ok(next.every(c => c.y === 64));
  assert.deepEqual([next[0].x, next[0].z], [102, 202], 'floor grows from the centre');
});

test('blocks in the way are reported as obstructions', () => {
  const w = world({ '101,65,201': 'short_grass', '100,64,200': 'dirt' });
  const report = survey(HOUSE, origin, w.nameAt);
  assert.deepEqual(report.obstructed.map(c => c.found).sort(), ['dirt', 'short_grass']);
});

test('floor over a gap asks for support underneath', () => {
  const w = world();
  for (let x = 99; x <= 105; x++) for (let z = 199; z <= 205; z++) w.blocks.set(`${x},63,${z}`, 'air');
  const report = survey(HOUSE, origin, w.nameAt);
  assert.ok(report.supports.length > 0);
  assert.ok(report.supports.every(c => c.y === 63 && c.material === 'filler'));
});

test('repeatedly placing the next placeable cell completes the whole house', () => {
  const w = world();
  for (let step = 0; step < 200; step++) {
    const report = survey(HOUSE, origin, w.nameAt);
    if (!report.missing.length) break;
    const next = placeable(report, origin, w.nameAt);
    assert.ok(next.length, `stuck with ${report.missing.length} missing`);
    build(w, next[0]);
    if (next[0].material === 'door') w.blocks.set(`${next[0].x},${next[0].y + 1},${next[0].z}`, 'oak_door');
  }
  const final = survey(HOUSE, origin, w.nameAt);
  assert.equal(final.missing.length, 0);
  assert.equal(progress(final).percent, 100);
  assert.equal(final.complete.length, HOUSE.cells.length);
});

test('without planks, other parts of the house remain placeable', () => {
  const w = world();
  const report = survey(HOUSE, origin, w.nameAt);
  for (const cell of placeable(report, origin, w.nameAt)) if (cell.material === 'cobblestone') build(w, cell);
  for (let i = 0; i < 30; i++) {
    const r = survey(HOUSE, origin, w.nameAt);
    const floor = placeable(r, origin, w.nameAt).find(c => c.material === 'cobblestone');
    if (!floor) break;
    build(w, floor);
  }
  const after = survey(HOUSE, origin, w.nameAt);
  const materials = new Set(placeable(after, origin, w.nameAt).map(c => c.material));
  assert.ok(materials.has('log') && materials.has('planks') && materials.has('door'));
});

test('the blueprint drawing defines every block exactly once', () => {
  const keys = HOUSE.cells.map(cellKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(HOUSE.cells.length, 101);
  assert.deepEqual(HOUSE.cells.find(c => c.material === 'door'), { x: 2, y: 1, z: 0, material: 'door' });
  assert.deepEqual(HOUSE.cells.find(c => c.material === 'stairs'), { x: 2, y: 0, z: -1, material: 'stairs' });
  assert.throws(() => parseLayers([['X']]), /Unknown blueprint symbol/);
});

test('progress is the percentage of required blocks placed correctly', () => {
  const w = world();
  const start = progress(survey(HOUSE, origin, w.nameAt));
  assert.deepEqual(start, { placed: 0, required: 83, percent: 0 });
  let report = survey(HOUSE, origin, w.nameAt);
  for (let i = 0; i < 25; i++) { build(w, placeable(report, origin, w.nameAt)[0]); report = survey(HOUSE, origin, w.nameAt); }
  assert.equal(progress(report).placed, 25);
  assert.equal(progress(report).percent, 30);
  // A wrong block in a required position does not count as progress.
  w.blocks.set(`${origin.x},${origin.y + 1},${origin.z}`, 'dirt');
  assert.equal(progress(survey(HOUSE, origin, w.nameAt)).placed, 25);
  // An unloaded site reports nothing placed rather than guessing.
  assert.equal(progress(survey(HOUSE, origin, () => null)).percent, 0);
});

test('a door never counts as something to build against', () => {
  // Only neighbour of this cell is a door below it: opening the door is all a right-click would do.
  const w = world({ '102,66,200': 'oak_door' });
  const cell = { x: 102, y: 67, z: 200, material: 'planks' };
  const report = { missing: [cell], supports: [] };
  assert.equal(placeable(report, origin, w.nameAt).length, 0);
});
