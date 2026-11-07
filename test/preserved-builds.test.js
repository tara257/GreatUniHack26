import test from 'node:test';
import assert from 'node:assert/strict';

process.env.BUILD_ORIGIN = '19,71,60';
process.env.STORAGE_POS = '31,72,44';
process.env.PRESERVED_AREAS = '[[36,71,40,43,77,48],[-10,60,-10,-5,65,-5]]';
const { Vec3, isPreserved, isProtected } = await import('../src/world.js');
const { dig, placeAt } = await import('../src/skills.js');

test('previous builds stay protected after moving the active house site', () => {
  for (const pos of [new Vec3(36,71,40), new Vec3(43,77,48), new Vec3(37,74,42), new Vec3(-7,62,-7)]) {
    assert.equal(isPreserved(pos), true);
    assert.equal(isProtected({}, pos), true);
  }
  for (const pos of [new Vec3(35,74,42), new Vec3(37,70,42), new Vec3(37,74,49)]) {
    assert.equal(isPreserved(pos), false);
  }
  // Storage and the active site still block harvesting/pathfinder digging,
  // while explicit builder clearing at the new site remains possible.
  assert.equal(isProtected({}, new Vec3(31,72,44)), true);
  assert.equal(isProtected({}, new Vec3(19,71,60)), true);
  assert.equal(isPreserved(new Vec3(19,71,60)), false);
});

test('direct digging and placement cannot modify preserved builds', async () => {
  const ctx = { bot: {}, alive: () => true };
  await assert.rejects(dig(ctx, [37,74,42]), /Preserved build/);
  await assert.rejects(placeAt(ctx, [37,74,42], 'oak_planks'), /Preserved build/);
  ctx.bot.blockAt = () => ({ name: 'air' });
  assert.equal(await dig(ctx, [19,71,60]), false);
});

test('clearing distant grass approaches within reach without requiring a collision face', async () => {
  let nearby = false, removed = false, goal;
  const position = new Vec3(19,71,60);
  const grass = { name: 'short_grass', boundingBox: 'empty', position };
  const ctx = { alive: () => true, bot: {
    blockAt: () => removed ? { name: 'air' } : grass,
    canDigBlock: () => nearby,
    pathfinder: {
      goto: async value => { goal = value; nearby = true; },
      bestHarvestTool: () => null,
    },
    dig: async block => { assert.equal(block, grass); removed = true; },
  }};
  assert.equal(await dig(ctx, position, { collect: false }), true);
  assert.equal(goal.constructor.name, 'GoalNear');
  assert.equal(goal.isEnd(new Vec3(20,71,60)), true);
  assert.equal(removed, true);
});

test('invalid preservation bounds fail visibly instead of silently dropping protection', async () => {
  for (const text of ['bad json', '{}', '[[0,0,0,1,1]]', '[[5,0,0,1,1,1]]', '[[0,0,0,1.5,1,1]]']) {
    process.env.PRESERVED_AREAS = text;
    await assert.rejects(import(`../src/world.js?invalid=${encodeURIComponent(text)}`), /PRESERVED_AREAS/);
  }
});
