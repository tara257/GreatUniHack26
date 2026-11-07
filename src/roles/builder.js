// BUILDER: compares the house blueprint with the world and places whatever it can.
import { total } from '../items.js';
import { requirements, cellKey } from '../blueprint.js';
import { baseView, siteView, findTargets } from './common.js';
import { free, outstanding, nextPlacement, fetchFromStorage, houseComplete, craftFromCarried, isHigh, BUILD_ITEMS, placeableMaterials, handOver } from './construction.js';
import { MAX_PILLAR } from '../skills.js';

const ROOF_Y = 3; // cells from this height up get a pillar if walking to them failed

export function perceive(ctx) {
  const v = siteView(ctx, baseView(ctx));
  v.tower = ctx.state.tower || [];
  // Dirt for a temporary pillar, dug from open ground away from the site and storage.
  v.fillerTarget = total(v.inv, 'filler') >= MAX_PILLAR ? null
    : findTargets(ctx, name => name === 'dirt' || name === 'grass_block', { maxDistance: 16, exposed: true })[0] || null;
  return v;
}

export const builderKeep = name => (BUILD_ITEMS.includes(name) || name === 'dirt' ? 999 : 0);

export function decide(v) {
  const action = choose(v);
  // Every builder message carries the measured progress, so !team status always shows it.
  if (v.progress) action.say = `${action.say} [house ${v.progress.percent}%: ${v.progress.placed}/${v.progress.required} blocks]`;
  return action;
}

/**
 * Builder rules, in priority order. Inventory is checked before every placement:
 * a cell is only chosen if the builder already holds a matching block.
 */
function choose(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  // 0. Remove any temporary pillar left behind by an interrupted roof job.
  if (v.tower.length) return { type: 'dismantle', say: 'Removing my temporary pillar' };
  if (!v.siteLoaded || v.distanceToSite > 48) {
    return { type: 'travel', target: v.origin.offset(4, 0, -3), range: 3, say: 'Walking to the building site' };
  }
  const { report } = v;
  if (v.full && Object.keys(v.inv).some(name => !builderKeep(name))) return { type: 'deposit', keep: builderKeep, say: 'Inventory full; storing everything not needed for the house' };

  // 1. Clear anything occupying a blueprint position (grass, dirt, misplaced or wrongly facing blocks).
  const obstruction = report.obstructed.find(free(v));
  if (obstruction) return { type: 'clear', target: obstruction, say: `Clearing ${obstruction.found} from the house site` };

  if (houseComplete(v)) return { type: 'done', say: 'The house matches the blueprint. Construction complete!' };

  // 2. Place the first buildable cell we hold material for. Missing one material
  //    simply moves us on to another part of the house.
  const cell = nextPlacement(v);
  if (cell) return { type: 'place', target: cell, group: cell.material, say: `Placing ${cell.material.replace('oak_', 'oak ')}` };

  // 3. Roof cells too high to reach, or that could not be reached by walking: pillar up and place from there.
  const roof = v.placeable.filter(c => total(v.inv, c.material) > 0 &&
    (isHigh(v, c) || (c.y >= v.origin.y + ROOF_Y && v.failed.has(cellKey(c)))));
  if (roof.length) {
    if (total(v.inv, 'filler') >= MAX_PILLAR) return { type: 'tower_place', target: roof[0], cells: roof, say: 'Roof out of reach; building a temporary pillar' };
    if (v.fillerTarget) return { type: 'mine', target: v.fillerTarget, say: 'Digging dirt for a temporary pillar' };
  }

  // 4. Make what is missing from what we carry: oak planks from spare oak logs, then stairs/fences/door.
  const need = outstanding(v);
  const logsNeeded = requirements(report.missing).oak_log || 0;
  if (need.oak_planks && total(v.inv, 'oak_log') > logsNeeded) {
    return { type: 'craft_planks', count: need.oak_planks, wood: 'oak', say: 'Turning spare oak logs into planks' };
  }
  const craft = craftFromCarried(v);
  if (craft) return craft;

  // 5. Fetch only materials we can place right now, and put back what we can't use yet, so storage
  //    (all that the crafter and helpers can see) reflects what the team really has.
  const placeableNow = placeableMaterials(v, { includeHigh: true });
  const fetch = fetchFromStorage(v, placeableNow);
  if (fetch) return fetch;
  const giveBack = handOver(v, placeableNow, 'Returning materials I cannot place yet to storage');
  if (giveBack) return giveBack;

  const list = Object.entries(need).filter(([g]) => g !== 'filler').map(([g, n]) => `${n} ${g.replace('oak_', '')}`).join(', ');
  return { type: 'wait', ms: 4000, say: list ? `Waiting for materials: ${list}` : 'Waiting for a reachable position to build' };
}

// The builder may walk inside the house (to reach the roof from below) but never digs while walking.
export function configureMovements(movements) {
  movements.canDig = false;
}
