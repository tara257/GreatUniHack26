// SCOUT: sweeps outward from spawn in a square spiral and reports useful resources over team chat.
// Reports queue while communication is down and are sent once it returns (see channel.js).
import pathfinderModule from 'mineflayer-pathfinder';
import { storageAnchor, waypointOffset as spiral } from '../world.js';
import { baseView, siteView, findTargets, reportOnce } from './common.js';
import { helpBuild } from './construction.js';
import { go } from '../skills.js';

const { goals: { GoalXZ } } = pathfinderModule;
export const SPACING = 24;
export const MAX_RING = Number(process.env.SCOUT_RINGS || 6);
export const waypointOffset = (step, spacing = SPACING, maxRing = MAX_RING) => spiral(step, spacing, maxRing);

// What the scout looks for, and whether only blocks open to the air count (reachable without digging).
const RESOURCES = [
  { kind: 'Wood', test: name => name === 'oak_log', exposed: false }, // the house is all oak
  { kind: 'Stone', test: name => name === 'stone', exposed: true },
  { kind: 'Sand', test: name => name === 'sand', exposed: true },
  { kind: 'Coal', test: name => name === 'coal_ore', exposed: true },
  { kind: 'Iron', test: name => name === 'iron_ore', exposed: true },
  { kind: 'Water', test: name => name === 'water', exposed: true },
];

export const regionOf = (kind, p) => `${kind}:${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;


// How often the scout returns to check whether the team has gathered everything.
export const STORAGE_CHECK_MS = 180_000;

export function perceive(ctx) {
  const v = siteView(ctx, baseView(ctx));
  v.sightings = [];
  for (const resource of RESOURCES) {
    const found = findTargets(ctx, resource.test, { maxDistance: 32, count: 16, protect: false, exposed: resource.exposed })[0];
    if (found) v.sightings.push({ kind: resource.kind, position: found });
  }
  v.reported = new Set(ctx.state.reported);
  v.step = ctx.state.scoutStep || 0;
  const anchor = storageAnchor(ctx.bot);
  const offset = waypointOffset(v.step);
  v.waypoint = { x: anchor.x + offset.x, z: anchor.z + offset.z };
  return v;
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  if (v.shortfall && v.shortfall.cobblestone === 0 && v.shortfall.wood === 0) return helpBuild(v);
  if (v.storageExists && (!v.storage || v.storage.age > STORAGE_CHECK_MS)) return { type: 'inspect_storage', say: 'Checking storage to see if the team still needs resources' };
  const fresh = v.sightings.find(s => !v.reported.has(regionOf(s.kind, s.position)));
  if (fresh) return { type: 'announce', kind: fresh.kind, target: fresh.position, say: `Found ${fresh.kind.toLowerCase()} at ${fresh.position.x} ${fresh.position.y} ${fresh.position.z}` };
  return { type: 'scout_move', waypoint: v.waypoint, say: `Exploring waypoint ${v.step + 1} at ${v.waypoint.x}, ${v.waypoint.z}` };
}

export const actions = {
  announce: (ctx, a) => { reportOnce(ctx, a.kind, a.target); },
  async scout_move(ctx, a) {
    // Advance the spiral whether or not the waypoint was reachable, so the scout never gets stuck on one spot.
    ctx.state.scoutStep = (ctx.state.scoutStep || 0) + 1;
    ctx.save();
    await go(ctx, new GoalXZ(a.waypoint.x, a.waypoint.z), 30000);
  },
};

export function configureMovements(movements) {
  movements.canDig = false;
}
