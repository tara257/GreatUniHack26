// Perception helpers shared by roles. These read the bot; decisions stay in each role's pure decide().
import { countItems } from '../items.js';
import { HOUSE, survey, placeable, requirements, progress } from '../blueprint.js';
import { merge, rawShortfall } from '../plan.js';
import { storageChests, isDangerous, isProtected, knownLocations, markExhausted, nearest, toVec, buildOrigin, storageAnchor, Vec3 } from '../world.js';

// Remembered resource locations further than this from home are ignored (matches skills.HOME_RANGE).
const HOME_RANGE = 96;

export const STORAGE_STALE_MS = 20_000;
export const keyOf = p => `${Math.floor(p.x ?? p[0])},${Math.floor(p.y ?? p[1])},${Math.floor(p.z ?? p[2])}`;
// What to remember about a failed action: its target position, or else what it was trying to do.
export const failureKey = action => (action.target ? keyOf(action.target) : `${action.type}:${action.item || ''}`);

export function baseView(ctx) {
  const { bot, memory } = ctx;
  const snapshot = memory.storage;
  return {
    inv: countItems(bot.inventory.items()),
    lowHealth: bot.health <= 6,
    full: bot.inventory.emptySlotCount() <= 2,
    storageExists: storageChests(bot).length > 0,
    // What this agent last saw inside storage, and how long ago. Null if never looked.
    storage: snapshot ? { contents: snapshot.contents, age: Date.now() - snapshot.at } : null,
    angle: ctx.angle,
  };
}

export function activeFailures(memory) {
  const now = Date.now();
  for (const [key, until] of memory.failed) if (until < now) memory.failed.delete(key);
  return new Set(memory.failed.keys());
}

/**
 * Nearby blocks matching names/test, filtered for danger, protected areas and recent failures,
 * sorted by distance with a penalty for height difference and for this agent's direction preference.
 */
export function findTargets(ctx, test, { maxDistance = 32, count = 64, protect = true, exposed = false } = {}) {
  const { bot, state, memory } = ctx;
  const failed = activeFailures(memory);
  const me = bot.entity.position;
  const matching = block => block && test(block.name);
  const positions = bot.findBlocks({ matching, maxDistance, count });
  const isExposed = p => [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]
    .some(([dx, dy, dz]) => bot.blockAt(p.offset(dx, dy, dz))?.name === 'air');
  return positions
    .filter(p => !failed.has(keyOf(p)) && !isDangerous(state, p) && !(protect && isProtected(bot, p)))
    .map(p => {
      const dx = p.x - me.x, dz = p.z - me.z;
      const directional = 6 * (1 - Math.cos(Math.atan2(dz, dx) - ctx.angle));
      const open = isExposed(p);
      return { p, open, score: me.distanceTo(p) + 3 * Math.abs(p.y - me.y) + directional + (open ? 0 : 6) };
    })
    .filter(t => !exposed || t.open)
    .sort((a, b) => a.score - b.score)
    .map(t => t.p);
}

/**
 * Nearest location of a resource kind that this agent saw earlier or was told about.
 * If we are standing at such a location and see nothing, it is marked exhausted locally.
 */
export function rememberedTarget(ctx, kind, seeingAny) {
  const { bot, state, save } = ctx;
  const me = bot.entity.position;
  let locations = knownLocations(state, kind);
  if (!seeingAny) {
    const here = locations.filter(p => me.distanceTo(toVec(p)) < 8);
    if (here.length) { here.forEach(p => markExhausted(state, p)); save(); locations = knownLocations(state, kind); }
  }
  // Skip places we recently failed to reach, and anything too far from home to be worth the trip.
  const failed = activeFailures(ctx.memory);
  const home = storageAnchor(bot);
  return nearest(me, locations.filter(p => !failed.has(keyOf(p)) && toVec(p).distanceTo(home) <= HOME_RANGE));
}

/** Publish a resource sighting once per 16-block region, so chat is not flooded with nearby duplicates. */
export function reportOnce(ctx, kind, position) {
  const p = toVec(position);
  const region = `${kind}:${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
  if (ctx.state.reported.includes(region)) return false;
  ctx.state.reported = [...ctx.state.reported, region].slice(-256);
  ctx.publish(kind, p);
  return true;
}

/**
 * What this agent can see of the house site: blueprint survey, buildable cells, progress,
 * and how much raw material it believes the team still has to collect.
 */
export function siteView(ctx, v) {
  const { bot } = ctx;
  const origin = buildOrigin(bot);
  const nameAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null;
  const propsAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.getProperties?.() ?? null;
  v.origin = origin;
  v.report = survey(HOUSE, origin, nameAt, propsAt);
  v.siteLoaded = v.report.unknown.length === 0;
  v.placeable = v.siteLoaded ? placeable(v.report, origin, nameAt) : [];
  v.progress = progress(v.report);
  v.failed = activeFailures(ctx.memory);
  v.distanceToSite = bot.entity.position.distanceTo(origin.offset(2, 0, 2));
  // Unloaded cells are assumed still needed.
  v.siteNeed = requirements([...v.report.missing, ...v.report.unknown]);
  v.furnaceNear = !!bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 24 });
  // Until this agent has looked in storage it cannot know the team has enough,
  // unless it can see that nothing is needed at all.
  const nothingNeeded = v.siteLoaded && !Object.keys(v.siteNeed).length;
  v.shortfall = v.storage || nothingNeeded
    ? rawShortfall(v.siteNeed, merge(v.storage?.contents, v.inv))
    : null;
  return v;
}
