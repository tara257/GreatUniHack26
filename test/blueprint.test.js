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
// Placing a cell puts exactly the blueprint block there (filler as dirt).
const build = (w, cell) => w.blocks.set(cellKey(cell), cell.material === 'filler' ? 'dirt' : cell.material);
const REQUIRED = 339;

test('the Nordic cottage is all oak and cobblestone, with a stair roof, fence windows and a door', () => {
  assert.deepEqual(blueprintNeeds(), { oak_stairs: 89, cobblestone: 128, oak_log: 18, oak_door: 1, oak_planks: 89, oak_fence: 13 });
  const stairs = HOUSE.cells.filter(c => c.material === 'oak_stairs');
  assert.ok(stairs.every(c => c.facing), 'every stair has a direction');
  assert.equal(stairs.filter(c => c.facing === 'east').length, 44); // west slope
  assert.equal(stairs.filter(c => c.facing === 'west').length, 44); // east slope
  assert.deepEqual(HOUSE.cells.find(c => c.facing === 'south'), { x: 4, y: 0, z: -1, material: 'oak_stairs', facing: 'south' });
  assert.ok(Object.keys(blueprintNeeds()).every(m => m === 'cobblestone' || m.startsWith('oak_')), 'one wood only');
});

test('the blueprint drawing defines every block exactly once', () => {
  const keys = HOUSE.cells.map(cellKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(HOUSE.cells.filter(c => c.material !== 'air').length, REQUIRED);
  assert.deepEqual(HOUSE.cells.find(c => c.material === 'oak_door'), { x: 4, y: 1, z: 0, material: 'oak_door' });
  assert.equal(HOUSE.cells.filter(c => c.y === 8).length, 11, 'plank ridge along the whole length');
  assert.throws(() => parseLayers([['X']]), /Unknown blueprint symbol/);
});

test('an empty flat site needs everything and only floor-level blocks can start', () => {
  const w = world();
  const report = survey(HOUSE, origin, w.nameAt);
  assert.equal(report.obstructed.length, 0);
  assert.deepEqual(requirements(report.missing), blueprintNeeds());
  const next = placeable(report, origin, w.nameAt);
  assert.ok(next.length > 0 && next.every(c => c.y === 64));
  assert.deepEqual([next[0].x, next[0].z], [104, 205], 'floor grows from the centre');
});

test('blocks in the way are reported as obstructions', () => {
  const w = world({ '101,65,201': 'short_grass', '100,64,200': 'dirt' });
  const report = survey(HOUSE, origin, w.nameAt);
  assert.deepEqual(report.obstructed.map(c => c.found).sort(), ['dirt', 'short_grass']);
});

test('stairs facing the wrong way, or upside down, are obstructions to replace', () => {
  const w = world({ '100,68,203': 'oak_stairs', '101,69,203': 'oak_stairs', '108,68,203': 'oak_stairs' });
  const props = { '100,68,203': { facing: 'west', half: 'bottom' }, '101,69,203': { facing: 'east', half: 'top' }, '108,68,203': { facing: 'west', half: 'bottom' } };
  const report = survey(HOUSE, origin, w.nameAt, (x, y, z) => props[`${x},${y},${z}`]);
  assert.deepEqual(report.obstructed.map(c => c.found).sort(), ['oak_stairs facing east upside down', 'oak_stairs facing west']);
  assert.ok(report.complete.some(c => c.x === 108 && c.y === 68 && c.z === 203), 'correct stair counts as placed');
});

test('floor over a gap asks for support underneath', () => {
  const w = world();
  for (let x = 99; x <= 109; x++) for (let z = 198; z <= 211; z++) w.blocks.set(`${x},63,${z}`, 'air');
  const report = survey(HOUSE, origin, w.nameAt);
  assert.ok(report.supports.length > 0);
  assert.ok(report.supports.every(c => c.y === 63 && c.material === 'filler'));
});

test('repeatedly placing the next placeable cell completes the whole house', () => {
  const w = world();
  for (let step = 0; step < 600; step++) {
    const report = survey(HOUSE, origin, w.nameAt);
    if (!report.missing.length) break;
    const next = placeable(report, origin, w.nameAt);
    assert.ok(next.length, `stuck with ${report.missing.length} missing`);
    build(w, next[0]);
    if (next[0].material === 'oak_door') w.blocks.set(`${next[0].x},${next[0].y + 1},${next[0].z}`, 'oak_door');
  }
  const final = survey(HOUSE, origin, w.nameAt);
  assert.equal(final.missing.length, 0);
  assert.equal(progress(final).percent, 100);
  assert.equal(final.complete.length, HOUSE.cells.length);
});

test('without planks, other parts of the house remain placeable', () => {
  const w = world();
  for (let i = 0; i < 200; i++) {
    const floor = placeable(survey(HOUSE, origin, w.nameAt), origin, w.nameAt).find(c => c.material === 'cobblestone');
    if (!floor) break;
    build(w, floor);
  }
  const materials = new Set(placeable(survey(HOUSE, origin, w.nameAt), origin, w.nameAt).map(c => c.material));
  assert.ok(materials.has('oak_log') && materials.has('oak_planks') && materials.has('oak_door'));
});

test('progress is the percentage of required blocks placed correctly', () => {
  const w = world();
  assert.deepEqual(progress(survey(HOUSE, origin, w.nameAt)), { placed: 0, required: REQUIRED, percent: 0 });
  let report = survey(HOUSE, origin, w.nameAt);
  for (let i = 0; i < 99; i++) { build(w, placeable(report, origin, w.nameAt)[0]); report = survey(HOUSE, origin, w.nameAt); }
  assert.equal(progress(report).placed, 99);
  assert.equal(progress(report).percent, 29);
  // A wrong block in a required position does not count as progress.
  w.blocks.set(`${origin.x},${origin.y + 1},${origin.z}`, 'dirt');
  assert.equal(progress(survey(HOUSE, origin, w.nameAt)).placed, 99);
  // An unloaded site reports nothing placed rather than guessing.
  assert.equal(progress(survey(HOUSE, origin, () => null)).percent, 0);
});

test('a door never counts as something to build against', () => {
  const w = world({ '104,66,200': 'oak_door' });
  const cell = { x: 104, y: 67, z: 200, material: 'oak_planks' };
  assert.equal(placeable({ missing: [cell], supports: [] }, origin, w.nameAt).length, 0);
});
