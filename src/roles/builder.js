// BUILDER: compares the house blueprint with the world and places whatever it can.
import { total, subtract, GROUPS } from '../items.js';
import { HOUSE, survey, placeable, requirements, canSupply, cellKey, insideFootprint, progress } from '../blueprint.js';
import { buildOrigin, Vec3 } from '../world.js';
import { baseView, activeFailures, STORAGE_STALE_MS } from './common.js';

export function perceive(ctx) {
  const { bot } = ctx;
  const v = baseView(ctx);
  const origin = buildOrigin(bot);
  const nameAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null;
  v.origin = origin;
  v.report = survey(HOUSE, origin, nameAt);
  v.siteLoaded = v.report.unknown.length === 0;
  v.progress = progress(v.report);
  v.placeable = v.siteLoaded ? placeable(v.report, origin, nameAt) : [];
  v.failed = activeFailures(ctx.memory);
  v.distanceToSite = bot.entity.position.distanceTo(origin.offset(2, 0, 2));
  return v;
}

const BUILD_GROUPS = ['cobblestone', 'planks', 'log', 'door', 'glass_pane', 'stairs'];
export const builderKeep = name => (BUILD_GROUPS.some(group => GROUPS[group](name)) ? 999 : 0);

/** Materials still needed, minus what the builder carries. */
export function outstanding(v) {
  return subtract(requirements([...v.report.missing, ...v.report.supports]), v.inv);
}

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
  if (!v.siteLoaded || v.distanceToSite > 48) {
    return { type: 'travel', target: v.origin.offset(2, 0, -3), range: 3, say: 'Walking to the building site' };
  }
  const { report } = v;
  if (v.full && Object.keys(v.inv).some(name => !builderKeep(name))) return { type: 'deposit', keep: builderKeep, say: 'Inventory full; storing everything not needed for the house' };
  const free = cell => !v.failed.has(cellKey(cell));

  // 1. Clear anything occupying a blueprint position (grass, dirt, misplaced blocks).
  const obstruction = report.obstructed.find(free);
  if (obstruction) return { type: 'clear', target: obstruction, say: `Clearing ${obstruction.found} from the house site` };

  if (!report.missing.length && !report.supports.length) return { type: 'done', say: 'The house matches the blueprint. Construction complete!' };

  // 2. Place the first buildable cell we hold material for. Missing one material
  //    simply moves us on to another part of the house.
  const cell = v.placeable.find(c => free(c) && canSupply(v.inv, c.material));
  if (cell) return { type: 'place', target: cell, group: cell.material, say: `Placing ${cell.material}` };

  // 3. Turn our own logs into planks if planks are the bottleneck and we have logs to spare.
  const need = outstanding(v);
  const logsNeeded = requirements(report.missing).log || 0;
  if (need.planks && total(v.inv, 'log') > logsNeeded) return { type: 'craft_planks', count: need.planks, say: 'Turning spare logs into planks' };

  // 4. Fetch outstanding materials from storage when it might have them.
  if (v.storageExists && Object.keys(need).length) {
    const stale = !v.storage || v.storage.age > STORAGE_STALE_MS;
    const available = Object.keys(need).filter(group => stale || total(v.storage.contents, group) > 0);
    if (available.length) {
      return {
        type: 'withdraw', wants: available.map(group => ({ group, count: Math.min(need[group], 64) })),
        say: `Fetching ${available.join(', ')} from storage`,
      };
    }
  }

  const list = Object.entries(need).map(([g, n]) => `${n} ${g}`).join(', ');
  return { type: 'wait', ms: 4000, say: list ? `Waiting for materials: ${list}` : 'Waiting for a reachable position to build' };
}

// Builders never dig while walking, and avoid walking through the house so they cannot wall themselves in.
export function configureMovements(movements, bot) {
  movements.canDig = false;
  // Origin is re-read each time: it follows the world spawn if that moves.
  movements.exclusionAreasStep = [block => (insideFootprint(HOUSE, buildOrigin(bot), block.position) ? 50 : 0)];
}
