// Low-level actions an agent can carry out. Roles decide *what* to do; these do it.
// Every action re-checks ctx.alive() after each await so pause/death/disconnect cancel promptly.
import pathfinderModule from 'mineflayer-pathfinder';
import { GROUPS, isEmpty, isSoft, isLog, countItems, total, planksFor, dominantWood } from './items.js';
import { HOUSE, insideFootprint } from './blueprint.js';
import { Vec3, toVec, storageAnchor, storageChests, buildOrigin } from './world.js';

const { goals } = pathfinderModule;
const { Goal, GoalNear, GoalXZ, GoalLookAtBlock, GoalPlaceBlock } = goals;

export class Cancelled extends Error {}

const FACES = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]].map(f => new Vec3(...f));

/** Wrap a goal so the agent never ends up standing inside the house footprint (it could wall itself in). */
class OutsideHouse extends Goal {
  constructor(inner, origin) { super(); this.inner = inner; this.origin = origin; }
  heuristic(node) { return this.inner.heuristic(node); }
  isEnd(node) { return !insideFootprint(HOUSE, this.origin, node) && this.inner.isEnd(node); }
}

export function check(ctx) { if (!ctx.alive()) throw new Cancelled('Task cancelled'); }

export async function go(ctx, goal, ms = 20000) {
  check(ctx);
  const { bot } = ctx;
  const timer = setTimeout(() => { if (ctx.alive()) bot.pathfinder.setGoal(null); }, ms);
  try { await bot.pathfinder.goto(goal); } finally { clearTimeout(timer); }
  check(ctx);
}

const outside = (ctx, goal) => ctx.role === 'builder' ? new OutsideHouse(goal, buildOrigin(ctx.bot)) : goal;
export const counts = bot => countItems(bot.inventory.items());
const findItem = (bot, group) => bot.inventory.items().find(item => (GROUPS[group] ? GROUPS[group](item.name) : item.name === group));
const itemId = (bot, name) => {
  const item = bot.registry.itemsByName[name];
  if (!item) throw new Error(`Unknown item ${name}`);
  return item.id;
};

// ── Movement and exploration ────────────────────────────────────────────────

export async function travel(ctx, target, range = 3, ms = 25000) {
  const p = toVec(target);
  await go(ctx, outside(ctx, new GoalNear(p.x, p.y, p.z, range)), ms);
}

export async function explore(ctx, angle, distance = 16, ms = 15000) {
  const p = ctx.bot.entity.position;
  await go(ctx, new GoalXZ(Math.floor(p.x + Math.cos(angle) * distance), Math.floor(p.z + Math.sin(angle) * distance)), ms);
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
    await go(ctx, outside(ctx, new GoalLookAtBlock(pos, bot.world, { reach: 4.4 })), 20000);
    block = bot.blockAt(pos);
    if (!block || isEmpty(block.name)) return false;
  }
  const tool = bot.pathfinder.bestHarvestTool(block);
  if (tool) await bot.equip(tool, 'hand');
  if (!bot.canDigBlock(block)) throw new Error(`Cannot reach ${block.name} at ${pos}`);
  await bot.dig(block, true);
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
  for (const face of doorLike ? [FACES[0]] : FACES) {
    const ref = bot.blockAt(pos.plus(face));
    if (ref && !isSoft(ref.name)) return { ref, face: face.scaled(-1) };
  }
  return null;
}

/** Place an item from a group (or an exact item name) into an empty position. */
export async function placeAt(ctx, target, group) {
  const { bot } = ctx;
  const pos = toVec(target);
  const item = findItem(bot, group);
  if (!item) throw new Error(`No ${group} to place`);
  const doorLike = GROUPS.door(item.name);
  if (!referenceFor(bot, pos, doorLike)) throw new Error(`Nothing to attach ${group} to at ${pos}`);
  const faces = doorLike ? [FACES[0]] : undefined;
  await go(ctx, outside(ctx, new GoalPlaceBlock(pos, bot.world, { range: 4.4, faces })), 20000);
  const current = bot.blockAt(pos);
  if (!current || !isEmpty(current.name)) return false;
  const reference = referenceFor(bot, pos, doorLike);
  if (!reference) throw new Error(`Lost reference block at ${pos}`);
  await bot.equip(item, 'hand');
  await bot.placeBlock(reference.ref, reference.face);
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

/** Craft `count` result items (rounded up to whole recipe batches, limited by ingredients). */
export async function craft(ctx, name, count = 1) {
  const { bot } = ctx;
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
  await bot.craft(recipe, times, table);
  check(ctx);
  return times * per;
}

export async function ensurePlanks(ctx, wanted) {
  const { bot } = ctx;
  let have = total(counts(bot), 'planks');
  while (have < wanted) {
    const log = findItem(bot, 'log');
    if (!log) throw new Error(`Need ${wanted - have} more planks and have no logs`);
    const batches = Math.min(log.count, Math.ceil((wanted - have) / 4));
    await craft(ctx, planksFor(log.name), batches * 4);
    have = total(counts(bot), 'planks');
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

/** Craft a wooden component (door, stairs) matching the wood we hold. */
export async function craftWooden(ctx, suffix, count) {
  const wood = dominantWood(counts(ctx.bot)) || 'oak';
  const name = `${wood}_${suffix}`;
  await ensureTable(ctx);
  await ensurePlanks(ctx, 6);
  return craft(ctx, ctx.bot.registry.itemsByName[name] ? name : `oak_${suffix}`, count);
}

export async function convertLogs(ctx, maxPlanks = Infinity) {
  const { bot } = ctx;
  let made = 0;
  for (const log of bot.inventory.items().filter(item => isLog(item.name))) {
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
    await go(ctx, new GoalNear(block.position.x, block.position.y, block.position.z, 2), 20000);
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
        try { await window.deposit(item.type, null, give); deposited += give; }
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
  place: (ctx, a) => placeAt(ctx, a.target, a.group),
  craft_tool: (ctx, a) => craftTool(ctx, a.item),
  craft_planks: (ctx, a) => convertLogs(ctx, a.count),
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

