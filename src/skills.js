// Low-level actions an agent can carry out. Roles decide *what* to do; these do it.
// Every action re-checks ctx.alive() after each await so pause/death/disconnect cancel promptly.
import pathfinderModule from 'mineflayer-pathfinder';
import { GROUPS, isEmpty, isSoft, isInteractive, isLog, countItems, total, planksFor, dominantWood, woodOf } from './items.js';
import { COMPONENTS } from './plan.js';
import { HOUSE, insideFootprint } from './blueprint.js';
import { Vec3, toVec, storageAnchor, storageChests, buildOrigin, waypointOffset } from './world.js';

const { goals } = pathfinderModule;
const { Goal, GoalNear, GoalXZ, GoalNearXZ, GoalBlock, GoalLookAtBlock, GoalPlaceBlock } = goals;

export class Cancelled extends Error {}

const FACES = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]].map(f => new Vec3(...f));

/** Wrap a goal so the agent ends up standing outside the house footprint (used for the door, so nobody shuts themselves in). */
class OutsideHouse extends Goal {
  constructor(inner, origin) { super(); this.inner = inner; this.origin = origin; }
  heuristic(node) { return this.inner.heuristic(node); }
  isEnd(node) { return !insideFootprint(HOUSE, this.origin, node) && this.inner.isEnd(node); }
}

export function check(ctx) { if (!ctx.alive()) throw new Cancelled('Task cancelled'); }

export async function go(ctx, goal, ms = 20000) {
  check(ctx);
  const { bot } = ctx;
  let expired=false;
  const timer = setTimeout(() => { if (ctx.alive()) { expired=true;bot.pathfinder.setGoal(null); } }, ms);
  try { await bot.pathfinder.goto(goal); }
  catch(error) { if(expired)throw new Error('Route timed out; choosing another approach');throw error; }
  finally { clearTimeout(timer); }
  check(ctx);
}

export const counts = bot => countItems(bot.inventory.items());
const findItem = (bot, group) => bot.inventory.items().find(item => (GROUPS[group] ? GROUPS[group](item.name) : item.name === group));
const itemId = (bot, name) => {
  const item = bot.registry.itemsByName[name];
  if (!item) throw new Error(`Unknown item ${name}`);
  return item.id;
};

// ── Movement and exploration ────────────────────────────────────────────────

export async function travel(ctx, target, range = 3, ms = 90000) {
  const p = toVec(target);
  const deadline=Date.now()+ms;
  // Bound path searches to nearby waypoints. Searching from a distant beach to
  // the chest in one pass can exhaust A* before the bot takes a single step.
  while(Math.hypot(p.x-ctx.bot.entity.position.x,p.z-ctx.bot.entity.position.z)>22) {
    check(ctx);
    if(Date.now()>=deadline)throw new Error('Long route timed out');
    const start=ctx.bot.entity.position.clone(),angle=Math.atan2(p.z-start.z,p.x-start.x);
    let moved=false,lastError;
    for(const turn of [0,Math.PI/3,-Math.PI/3]) {
      try {
        await go(ctx,new GoalNearXZ(Math.floor(start.x+Math.cos(angle+turn)*16),Math.floor(start.z+Math.sin(angle+turn)*16),3),Math.min(20000,Math.max(1,deadline-Date.now())));
        moved=ctx.bot.entity.position.distanceTo(start)>3;if(moved)break;
      } catch(error) {check(ctx);lastError=error;}
    }
    if(!moved)throw lastError || new Error('No accessible waypoint on this route');
  }
  await go(ctx, new GoalNear(p.x, p.y, p.z, range), Math.max(1,deadline-Date.now()));
}

// Agents explore within this distance of home (the storage spot).
export const HOME_RANGE = 96;
export const EXPLORE_SPACING = 16;

/**
 * Search the area around home by visiting the waypoints of a square spiral (16 blocks apart, out to
 * HOME_RANGE, then starting again). Each agent's spiral is rotated by its own preferred direction so
 * they search different ground first. A waypoint that can't be reached is skipped.
 */
export async function explore(ctx, angle, distance = EXPLORE_SPACING, ms = 20000) {
  const home = storageAnchor(ctx.bot);
  const step = ctx.memory.exploreStep || 0;
  ctx.memory.exploreStep = step + 1;
  const { x, z } = waypointOffset(step, distance, Math.floor(HOME_RANGE / distance));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  await go(ctx, new GoalXZ(Math.floor(home.x + x * cos - z * sin), Math.floor(home.z + x * sin + z * cos)), ms);
}

// ── Digging and collecting ──────────────────────────────────────────────────

export async function collectDrops(ctx, around, radius = 5) {
  const { bot } = ctx;
  const drops = Object.values(bot.entities)
    .filter(e => e.name === 'item' && e.position.distanceTo(around) <= radius)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
    .slice(0, 4);
  for (const drop of drops) {
    if (!bot.entities[drop.id]) continue;
    try { await go(ctx, new GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5), 5000); }
    catch (error) { if (error instanceof Cancelled) throw error; }
  }
}

export async function dig(ctx, target, { collect = true, approach = true } = {}) {
  const { bot } = ctx;
  const pos = toVec(target);
  let block = bot.blockAt(pos);
  if (!block || isEmpty(block.name)) return false;
  if (approach && !bot.canDigBlock(block)) {
    await go(ctx, new GoalLookAtBlock(pos, bot.world, { reach: 4.4 }), 20000);
    block = bot.blockAt(pos);
    if (!block || isEmpty(block.name)) return false;
  }
  const tool = bot.pathfinder.bestHarvestTool(block);
  if (tool) await bot.equip(tool, 'hand');
  if (!bot.canDigBlock(block)) throw new Error(`Cannot reach ${block.name} at ${pos}`);
  const evidenceTicket = ctx.evidence?.begin();
  await bot.dig(block, true);
  const afterDig = bot.blockAt(pos);
  if (afterDig && afterDig.name !== block.name && (isLog(block.name) || /^(stone|deepslate|sand|red_sand)$|_ore$/.test(block.name))) ctx.evidence?.record(evidenceTicket, 'resourceBlocks', 1, block.name);
  check(ctx);
  if (collect) await collectDrops(ctx, pos);
  return true;
}

/** Fell a tree from a log position: the log itself and any logs directly above within reach. */
export async function chop(ctx, target) {
  const { bot } = ctx;
  const base = toVec(target);
  if (!(await dig(ctx, base, { collect: false }))) return false;
  for (let dy = 1; dy <= 6; dy++) {
    const block = bot.blockAt(base.offset(0, dy, 0));
    if (!block || !isLog(block.name)) break;
    if (!bot.canDigBlock(block)) break;
    await dig(ctx, block.position, { collect: false, approach: false });
  }
  await collectDrops(ctx, base, 6);
  return true;
}

// ── Placing ─────────────────────────────────────────────────────────────────

function referenceFor(bot, pos, doorLike) {
  // The block above is the last resort: clicking its underside would place stairs upside down.
  for (const face of doorLike ? [FACES[0]] : [FACES[0], ...FACES.slice(2), FACES[1]]) {
    const ref = bot.blockAt(pos.plus(face));
    if (ref && !isSoft(ref.name) && !isInteractive(ref.name)) return { ref, face: face.scaled(-1) };
  }
  return null;
}

// Mineflayer yaw for each compass direction; stairs face the way the placer is looking.
const YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

/** Place the held block against a reference, facing a compass direction if one is given. */
export async function placeFacing(ctx, reference, facing) {
  const { bot } = ctx;
  if (!facing) return bot.placeBlock(reference.ref, reference.face);
  await bot.look(YAW[facing], 0, true);
  await new Promise(resolve => setTimeout(resolve, 150)); // make sure the server has our new heading
  // Do not turn towards the block: the server takes the stair direction from our heading.
  // Clicking the lower half of a side face (or a top face) gives an upright stair.
  return bot._placeBlockWithOptions(reference.ref, reference.face, { forceLook: 'ignore', half: 'bottom', swingArm: 'right' });
}

/** Place an item from a group (or an exact item name) into an empty position. */
export async function placeAt(ctx, target, group, facing = null) {
  const { bot } = ctx;
  const pos = toVec(target);
  const item = findItem(bot, group);
  if (!item) throw new Error(`No ${group} to place`);
  const doorLike = GROUPS.door(item.name);
  if (!referenceFor(bot, pos, doorLike)) throw new Error(`Nothing to attach ${group} to at ${pos}`);
  const faces = doorLike ? [FACES[0]] : undefined;
  // No line-of-sight requirement: the server only checks reach, so roof blocks can be placed
  // against the top of a wall from below or from inside the house.
  const goal = new GoalPlaceBlock(pos, bot.world, { range: 4.4, LOS: false, faces });
  // The door is fitted from outside so the agent is never shut in.
  await go(ctx, doorLike ? new OutsideHouse(goal, buildOrigin(bot)) : goal, 20000);
  const current = bot.blockAt(pos);
  if (!current || !isEmpty(current.name)) return false;
  const reference = referenceFor(bot, pos, doorLike);
  if (!reference) throw new Error(`Lost reference block at ${pos}`);
  await bot.equip(item, 'hand');
  const evidenceTicket = ctx.evidence?.begin();
  await placeFacing(ctx, reference, facing);
  const placed = bot.blockAt(pos);
  if (placed && (GROUPS[group] ? GROUPS[group](placed.name) : placed.name === group)) ctx.evidence?.record(evidenceTicket, 'blocksPlaced', 1, placed.name);
  check(ctx);
  return true;
}

/** Put a utility block (chest, crafting table, furnace) on open ground near a point. */
export async function placeNear(ctx, itemName, near) {
  const { bot } = ctx;
  const centre = toVec(near).floored();
  const origin = buildOrigin(bot);
  const feet = bot.entity.position.floored();
  const spots = [];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -2; dy <= 2; dy++) {
    if (!dx && !dz) continue;
    const p = centre.offset(dx, dy, dz);
    if (insideFootprint(HOUSE, origin, p, 1)) continue;
    if (p.x === feet.x && p.z === feet.z && Math.abs(p.y - feet.y) <= 1) continue;
    const below = bot.blockAt(p.offset(0, -1, 0)), here = bot.blockAt(p), above = bot.blockAt(p.offset(0, 1, 0));
    if (!below || !here || !above || isSoft(below.name) || /chest|table|furnace|barrel/.test(below.name)) continue;
    if (here.name !== 'air' || above.name !== 'air') continue;
    spots.push(p);
  }
  spots.sort((a, b) => a.distanceTo(centre) - b.distanceTo(centre));
  for (const spot of spots.slice(0, 4)) {
    try { if (await placeAt(ctx, spot, itemName)) return bot.blockAt(spot); }
    catch (error) { if (error instanceof Cancelled) throw error; ctx.log(`Could not place ${itemName} at ${spot}: ${error.message}`); }
  }
  throw new Error(`No open ground for a ${itemName} near ${centre}`);
}

// ── Crafting ────────────────────────────────────────────────────────────────

export function findNearby(bot, blockName, maxDistance = 24) {
  const id = bot.registry.blocksByName[blockName]?.id;
  return id == null ? null : bot.findBlock({ matching: id, maxDistance });
}

export async function ensureTable(ctx) {
  const { bot } = ctx;
  const existing = findNearby(bot, 'crafting_table');
  if (existing) return existing;
  if (!findItem(bot, 'crafting_table')) {
    await ensurePlanks(ctx, 4);
    await craft(ctx, 'crafting_table', 1);
  }
  const anchor = storageAnchor(bot);
  const near = bot.entity.position.distanceTo(anchor) < 24 ? anchor : bot.entity.position;
  return placeNear(ctx, 'crafting_table', near);
}

/**
 * bot.craft resolves before the server has finished updating our inventory; crafting again straight
 * away then sees stale slots ("missing ingredient", "updateSlot did not fire"). Wait until no slot
 * has changed for a moment.
 */
export async function inventorySettled(bot, quietMs = 400, maxMs = 3000) {
  if (typeof bot.inventory?.on !== 'function') return; // nothing to listen to (e.g. a test double)
  let last = Date.now();
  const touched = () => { last = Date.now(); };
  bot.inventory.on('updateSlot', touched);
  try {
    const start = Date.now();
    while (Date.now() - last < quietMs && Date.now() - start < maxMs) await new Promise(r => setTimeout(r, 50));
  } finally { bot.inventory.removeListener('updateSlot', touched); }
}

/** Craft `count` result items (rounded up to whole recipe batches, limited by ingredients). */
export async function craft(ctx, name, count = 1) {
  const { bot } = ctx;
  // Recover ingredients/cursor left by a timed-out inventory craft.
  if (bot.colonyInventorySync && !bot.currentWindow) {
    const inventory = bot.inventory;
    if (inventory.selectedItem) await bot.putSelectedItemRange(inventory.inventoryStart, inventory.inventoryEnd, inventory, null);
    for (let slot = 1; slot <= 4; slot++) if (inventory.slots[slot]) await bot.putAway(slot);
  }
  const id = itemId(bot, name);
  let table = null;
  if (!bot.recipesAll(id, null, null).length) {
    table = await ensureTable(ctx);
    if (bot.entity.position.distanceTo(table.position) > 3.5) {
      await go(ctx, new GoalNear(table.position.x, table.position.y, table.position.z, 2), 15000);
    }
    table = bot.blockAt(table.position);
  }
  const recipe = bot.recipesFor(id, null, 1, table)[0];
  if (!recipe) throw new Error(`Missing ingredients for ${name}`);
  const per = recipe.result.count;
  let times = Math.max(1, Math.ceil(count / per));
  while (times > 1 && !bot.recipesFor(id, null, times * per, table).length) times--;
  const evidenceTicket = ctx.evidence?.begin(), heldBefore = counts(bot)[name] || 0;
  // One craft at a time: mineflayer's own repeat count runs ahead of the server's slot updates.
  for (let i = 0; i < times; i++) {
    await bot.craft(recipe, 1, table);
    await inventorySettled(bot);
    check(ctx);
  }
  if (bot.colonyInventorySync) await bot._syncWindow(bot.inventory);
  const gained = Math.min(times * per, (counts(bot)[name] || 0) - heldBefore);
  if (gained <= 0) throw new Error(`Crafting ${name} produced no confirmed inventory gain`);
  ctx.evidence?.record(evidenceTicket, 'itemsCrafted', gained, name);
  check(ctx);
  return times * per;
}

/**
 * Make sure we hold `wanted` planks of ONE wood type (recipes such as chests and tables need
 * matching planks). Uses `wood` if given, otherwise whichever type we have most of.
 */
export async function ensurePlanks(ctx, wanted, wood = null) {
  const { bot } = ctx;
  const type = wood || dominantWood(counts(bot));
  if (!type) throw new Error('Need wood to craft planks');
  const plankName = `${type}_planks`;
  let have = counts(bot)[plankName] || 0;
  while (have < wanted) {
    const log = bot.inventory.items().find(item => isLog(item.name) && woodOf(item.name) === type);
    if (!log) throw new Error(`Need ${wanted - have} more ${plankName} and have no ${type} logs`);
    const batches = Math.min(log.count, Math.ceil((wanted - have) / 4));
    await craft(ctx, planksFor(log.name), batches * 4);
    const next = counts(bot)[plankName] || 0;
    if (next <= have) throw new Error(`Crafting ${plankName} produced no confirmed inventory gain`);
    have = next;
  }
}

export async function ensureSticks(ctx, wanted) {
  const have = total(counts(ctx.bot), 'stick');
  if (have >= wanted) return;
  const batches = Math.ceil((wanted - have) / 4);
  await ensurePlanks(ctx, batches * 2);
  await craft(ctx, 'stick', batches * 4);
}

/** Craft a tool, preparing the table, sticks and planks it needs. */
export async function craftTool(ctx, name) {
  await ensureTable(ctx);
  await ensureSticks(ctx, 2);
  if (name.startsWith('wooden_')) await ensurePlanks(ctx, 3);
  await craft(ctx, name, 1);
}

/** Craft an oak house component (oak_door, oak_fence, oak_stairs), preparing planks and sticks. */
export async function craftComponent(ctx, item, count) {
  const component = COMPONENTS.find(c => c.item === item);
  if (!component) throw new Error(`Unknown component ${item}`);
  const batches = Math.max(1, Math.ceil(count / component.makes));
  await ensureTable(ctx);
  if (item === 'oak_fence') await ensureSticks(ctx, 2 * batches);
  await ensurePlanks(ctx, (item === 'oak_fence' ? 4 : 6) * batches, 'oak');
  return craft(ctx, item, batches * component.makes);
}

/** Turn logs into planks (only logs of `wood` if given), up to maxPlanks. */
export async function convertLogs(ctx, maxPlanks = Infinity, wood = null) {
  const { bot } = ctx;
  let made = 0;
  for (const log of bot.inventory.items().filter(item => isLog(item.name) && (!wood || woodOf(item.name) === wood))) {
    if (made >= maxPlanks) break;
    const batches = Math.min(log.count, Math.ceil((maxPlanks - made) / 4));
    made += await craft(ctx, planksFor(log.name), batches * 4);
  }
  return made;
}

// ── Shared storage ──────────────────────────────────────────────────────────

/** Find storage chests, building one if none exists and we have the wood for it. */
export async function ensureStorage(ctx, { create = true } = {}) {
  const { bot } = ctx;
  let chests = storageChests(bot);
  if (chests.length || !create) return chests;
  const c = counts(bot);
  const tableNear = !!findNearby(bot, 'crafting_table');
  if (!findItem(bot, 'chest') && total(c, 'planks') + 4 * total(c, 'log') < (tableNear ? 8 : 12)) return [];
  ctx.narrate('No shared storage yet; building a chest at spawn');
  if (!findItem(bot, 'chest')) {
    await ensureTable(ctx);
    await ensurePlanks(ctx, 8);
    await craft(ctx, 'chest', 1);
  }
  await placeNear(ctx, 'chest', storageAnchor(bot));
  chests = storageChests(bot);
  return chests;
}

async function withChest(ctx, block, fn) {
  const { bot } = ctx;
  if (bot.entity.position.distanceTo(block.position) > 3.5) {
    await travel(ctx,block.position,2);
  }
  const window = await bot.openContainer(bot.blockAt(block.position));
  ctx.memory.window = window;
  try { return await fn(window); } finally { window.close(); ctx.memory.window = null; }
}

function remember(ctx, contentsByChest) {
  const contents = {};
  for (const chest of contentsByChest.values()) for (const [name, n] of Object.entries(chest)) contents[name] = (contents[name] || 0) + n;
  ctx.memory.storage = { contents, at: Date.now() };
  return contents;
}

export async function inspectStorage(ctx) {
  const chests = await ensureStorage(ctx, { create: false });
  if (!chests.length) { ctx.memory.storage = { contents: {}, at: Date.now(), missing: true }; return {}; }
  const seen = new Map();
  for (const chest of chests) seen.set(chest.position.toString(), await withChest(ctx, chest, w => countItems(w.containerItems())));
  return remember(ctx, seen);
}

/** Deposit everything except what keep(name) says to hold back. */
export async function deposit(ctx, keep = () => 0) {
  const { bot } = ctx;
  const chests = await ensureStorage(ctx);
  if (!chests.length) throw new Error('No shared storage chest yet');
  const seen = new Map();
  const plan = () => {
    const held = {};
    return bot.inventory.items().map(item => {
      const hold = Math.min(item.count, Math.max(0, keep(item.name) - (held[item.name] || 0)));
      held[item.name] = (held[item.name] || 0) + hold;
      return { item, give: item.count - hold };
    });
  };
  let deposited = 0;
  for (const chest of chests) {
    seen.set(chest.position.toString(), await withChest(ctx, chest, async window => {
      for (const { item, give } of plan()) {
        if (give <= 0) continue;
        try {
          const evidenceTicket = ctx.evidence?.begin(), heldBefore = counts(bot)[item.name] || 0;
          await window.deposit(item.type, null, give); deposited += give;
          ctx.evidence?.record(evidenceTicket, 'itemsDeposited', Math.min(give, heldBefore - (counts(bot)[item.name] || 0)), item.name);
        }
        catch { break; } // chest full: try the next one
      }
      return countItems(window.containerItems());
    }));
    if (plan().every(entry => entry.give <= 0)) break;
  }
  remember(ctx, seen);
  return deposited;
}

/** Take up to `count` of each wanted group: [{ group, count }]. */
export async function withdraw(ctx, wants) {
  const { bot } = ctx;
  const chests = await ensureStorage(ctx, { create: false });
  if (!chests.length) throw new Error('No shared storage chest yet');
  const remaining = new Map(wants.map(w => [w.group, w.count]));
  const seen = new Map();
  const taken = {};
  for (const chest of chests) {
    seen.set(chest.position.toString(), await withChest(ctx, chest, async window => {
      for (const [group, need] of remaining) {
        let left = need;
        const test = GROUPS[group] || (name => name === group);
        for (const item of window.containerItems().filter(i => test(i.name))) {
          if (left <= 0 || bot.inventory.emptySlotCount() === 0) break;
          const n = Math.min(left, item.count);
          await window.withdraw(item.type, null, n);
          left -= n; taken[item.name] = (taken[item.name] || 0) + n;
        }
        remaining.set(group, left);
      }
      return countItems(window.containerItems());
    }));
  }
  remember(ctx, seen);
  return taken;
}

// ── Smelting ────────────────────────────────────────────────────────────────

export async function ensureFurnace(ctx) {
  const { bot } = ctx;
  const existing = findNearby(bot, 'furnace');
  if (existing) return existing;
  if (!findItem(bot, 'furnace')) {
    if (total(counts(bot), 'cobblestone') < 8) throw new Error('Need 8 cobblestone for a furnace');
    await ensureTable(ctx);
    await craft(ctx, 'furnace', 1);
  }
  return placeNear(ctx, 'furnace', storageAnchor(bot));
}

export async function smelt(ctx, input, count) {
  const { bot } = ctx;
  const furnaceBlock = await ensureFurnace(ctx);
  if (bot.entity.position.distanceTo(furnaceBlock.position) > 3.5) {
    await go(ctx, new GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2), 15000);
  }
  const source = findItem(bot, input);
  if (!source) throw new Error(`No ${input} to smelt`);
  const amount = Math.min(count, total(counts(bot), input));
  const furnace = await bot.openFurnace(bot.blockAt(furnaceBlock.position));
  ctx.memory.window = furnace;
  try {
    if (furnace.outputItem()) await furnace.takeOutput();
    if (!furnace.fuelItem()) {
      const coal = findItem(bot, 'coal');
      const fuel = coal || findItem(bot, 'planks') || findItem(bot, 'log');
      if (!fuel) throw new Error('No fuel for the furnace');
      // Coal smelts 8 items; planks and logs 1.5 each.
      const units = coal ? Math.ceil(amount / 8) : Math.ceil(amount / 1.5);
      await furnace.putFuel(fuel.type, null, Math.min(units, fuel.count));
    }
    await furnace.putInput(source.type, null, amount);
    const deadline = Date.now() + amount * 11000 + 5000;
    while (Date.now() < deadline && (furnace.outputItem()?.count || 0) < amount) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      check(ctx);
      ctx.narrate(`Smelting ${input}: ${furnace.outputItem()?.count || 0}/${amount}`);
    }
    if (furnace.outputItem()) await furnace.takeOutput();
  } finally { furnace.close(); ctx.memory.window = null; }
}

// ── Temporary pillar for out-of-reach roof blocks ───────────────────────────

const waitFor = async (condition, ms) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
};
const eyeOf = bot => bot.entity.position.offset(0, 1.62, 0);

export const MAX_PILLAR = 6;

/**
 * Find somewhere to stand and pillar up so `target` is within reach: open ground just outside the
 * house or on its floor inside, whichever needs the shortest pillar.
 */
function pillarSpot(bot, origin, goal) {
  const centre = goal.offset(0.5, 0.5, 0.5);
  let best = null;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    for (let y = origin.y - 1; y <= origin.y + 2; y++) {
      const p = new Vec3(goal.x + dx, y, goal.z + dz);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (!below || isSoft(below.name) || isInteractive(below.name) || bot.blockAt(p)?.name !== 'air') continue;
      for (let h = 0; h <= MAX_PILLAR; h++) {
        // Room for the pillar plus our body above it, and not through the target itself.
        const blocked = [h, h + 1].some(k => bot.blockAt(p.offset(0, k, 0))?.name !== 'air' || p.offset(0, k, 0).equals(goal));
        if (blocked) break;
        const eye = new Vec3(p.x + 0.5, p.y + h + 1.62, p.z + 0.5);
        if (eye.distanceTo(centre) <= 4.3) {
          const score = h * 3 + Math.hypot(dx, dz);
          if (!best || score < best.score) best = { p, h, score };
          break;
        }
      }
      break; // only the lowest standable spot in this column
    }
  }
  return best;
}

/** Pillar up with filler, place every listed cell now within reach, then remove the pillar. */
export async function towerPlace(ctx, target, cells) {
  const { bot, state } = ctx;
  const origin = buildOrigin(bot);
  const spot = pillarSpot(bot, origin, toVec(target));
  if (!spot) throw new Error(`Nowhere to pillar up to ${toVec(target)}`);
  if (total(counts(bot), 'filler') < spot.h) throw new Error(`Need ${spot.h} dirt for a pillar`);
  await go(ctx, new GoalBlock(spot.p.x, spot.p.y, spot.p.z), 25000);

  state.tower = state.tower || [];
  for (let i = 0; i < spot.h; i++) {
    const filler = findItem(bot, 'filler');
    if (!filler) break;
    await bot.equip(filler, 'hand');
    const feet = bot.entity.position.floored();
    await bot.look(bot.entity.yaw, -Math.PI / 2, true);
    bot.setControlState('jump', true);
    await waitFor(() => bot.entity.position.y >= feet.y + 1.05, 1500);
    try { await bot.placeBlock(bot.blockAt(feet.offset(0, -1, 0)), new Vec3(0, 1, 0)); }
    finally { bot.setControlState('jump', false); }
    state.tower.push([feet.x, feet.y, feet.z]);
    ctx.save();
    await waitFor(() => bot.entity.onGround, 1500);
    check(ctx);
  }

  // Place every listed cell now within reach that we have material for, lowest first.
  let placed = 0;
  for (const cell of [...cells].sort((a, b) => a.y - b.y)) {
    const pos = toVec(cell);
    if (!isEmpty(bot.blockAt(pos)?.name ?? 'stone') || eyeOf(bot).distanceTo(pos.offset(0.5, 0.5, 0.5)) > 4.5) continue;
    const item = findItem(bot, cell.material);
    const reference = referenceFor(bot, pos, false);
    if (!item || !reference) continue;
    try { await bot.equip(item, 'hand'); await placeFacing(ctx, reference, cell.facing); placed++; }
    catch (error) { ctx.log(`Pillar placement at ${pos} failed: ${error.message}`); }
    check(ctx);
  }
  await dismantleTower(ctx);
  return placed;
}

/** Dig out pillar blocks from the top down (also used to clean up after an interrupted pillar). */
export async function dismantleTower(ctx) {
  const { bot, state } = ctx;
  while (state.tower?.length) {
    const top = toVec(state.tower[state.tower.length - 1]);
    const block = bot.blockAt(top);
    if (block && !isEmpty(block.name)) await dig(ctx, top, { collect: true });
    state.tower.pop();
    ctx.save();
    await waitFor(() => bot.entity.onGround, 1500);
  }
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const actions = {
  rest: () => wait(2000),
  wait: (ctx, a) => wait(a.ms ?? 3000),
  done: () => wait(5000),
  travel: (ctx, a) => travel(ctx, a.target, a.range ?? 3),
  explore: (ctx, a) => explore(ctx, a.angle, a.distance),
  mine: (ctx, a) => dig(ctx, a.target),
  chop: (ctx, a) => chop(ctx, a.target),
  // Builders leave cleared drops where they fall rather than walking into the footprint.
  clear: (ctx, a) => dig(ctx, a.target, { collect: false }),
  place: (ctx, a) => placeAt(ctx, a.target, a.group, a.target.facing),
  tower_place: (ctx, a) => towerPlace(ctx, a.target, a.cells),
  dismantle: ctx => dismantleTower(ctx),
  craft_tool: (ctx, a) => craftTool(ctx, a.item),
  craft_planks: (ctx, a) => convertLogs(ctx, a.count, a.wood),
  // Craft a house component; fetch inputs from storage first and return the results if asked.
  make: async (ctx, a) => {
    const held = counts(ctx.bot);
    const wants = (a.inputs || []).filter(i => total(held, i.group) < i.count).map(i => ({ group: i.group, count: i.count - total(held, i.group) }));
    if (wants.length) await withdraw(ctx, wants);
    if (a.item === 'oak_planks') await convertLogs(ctx, a.count, 'oak');
    else await craftComponent(ctx, a.item, a.count);
    if (a.returnToStorage) await deposit(ctx, a.keep || (() => 0));
  },
  inspect_storage: ctx => inspectStorage(ctx),
  withdraw: (ctx, a) => withdraw(ctx, a.wants),
  deposit: async (ctx, a) => {
    if (a.convertLogs) await convertLogs(ctx);
    return deposit(ctx, a.keep);
  },
  report: (ctx, a) => { ctx.publish(a.kind, toVec(a.target)); },
};

export async function run(ctx, action) {
  const handler = actions[action.type] || ctx.roleActions?.[action.type];
  if (!handler) throw new Error(`Unknown action ${action.type}`);
  return handler(ctx, action);
}

