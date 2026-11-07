// LUMBERJACK: fells nearby trees, turns surplus logs into planks, and stocks shared storage.
import { total, isLog } from '../items.js';
import { blueprintNeeds } from '../blueprint.js';
import { baseView, findTargets, rememberedTarget } from './common.js';

export const DEPOSIT_AT = Number(process.env.LUMBERJACK_DEPOSIT || 16);
// Logs kept as logs in storage: the blueprint's corner posts plus some for other agents' crafting.
export const LOG_RESERVE = (blueprintNeeds().log || 0) + 8;

export const lumberjackKeep = name => (/_axe$/.test(name) ? 64 : 0);

export function perceive(ctx) {
  const v = baseView(ctx);
  const y = ctx.bot.entity.position.y;
  // Prefer trunks near our own height: those can be reached and felled from the ground.
  v.tree = findTargets(ctx, isLog, { maxDistance: 32 }).find(p => p.y - y <= 3 && y - p.y <= 4) || null;
  v.knownWood = v.tree ? null : rememberedTarget(ctx, 'Wood', false);
  return v;
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  const logs = total(v.inv, 'log');
  const carried = logs + Math.floor(total(v.inv, 'planks') / 4);
  const nothingNearby = !v.tree && !v.knownWood;

  if (v.full || carried >= DEPOSIT_AT || (nothingNearby && carried >= 4)) {
    // Once storage already holds enough logs (as last seen), the rest become planks.
    const convertLogs = logs > 0 && !!v.storage && total(v.storage.contents, 'log') >= LOG_RESERVE;
    return {
      type: 'deposit', keep: lumberjackKeep, convertLogs,
      say: convertLogs ? `Storage has enough logs; delivering ${logs} logs as planks` : `Delivering ${carried} wood to storage`,
    };
  }
  if (v.tree) return { type: 'chop', target: v.tree, say: `Chopping a tree (${carried}/${DEPOSIT_AT})` };
  if (v.knownWood) return { type: 'travel', target: v.knownWood, say: 'Heading to known trees' };
  return { type: 'explore', angle: v.angle, say: 'Searching for trees' };
}

export function configureMovements(movements) {
  movements.canDig = false;
}
