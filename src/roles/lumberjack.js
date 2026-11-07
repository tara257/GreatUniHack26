// LUMBERJACK: fells nearby oak trees, turns surplus logs into planks, and stocks shared storage.
// Only oak is chopped so the whole house is one wood.
import { total } from '../items.js';
import { blueprintNeeds } from '../blueprint.js';
import { baseView, siteView, findTargets, rememberedTarget } from './common.js';
import { helpBuild } from './construction.js';

export const DEPOSIT_AT = Number(process.env.LUMBERJACK_DEPOSIT || 16);
// Logs kept as logs in storage: the blueprint's log posts plus some for other agents' crafting.
export const LOG_RESERVE = (blueprintNeeds().oak_log || 0) + 8;
export const isOakLog = name => name === 'oak_log';

export const lumberjackKeep = name => (/_axe$/.test(name) ? 64 : 0);

export function perceive(ctx) {
  const v = siteView(ctx, baseView(ctx));
  const y = ctx.bot.entity.position.y;
  // Prefer trunks near our own height: those can be reached and felled from the ground.
  v.tree = findTargets(ctx, isOakLog, { maxDistance: 32 }).find(p => p.y - y <= 3 && y - p.y <= 4) || null;
  v.knownWood = v.tree ? null : rememberedTarget(ctx, 'Wood', false);
  return v;
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  const logs = total(v.inv, 'oak_log');
  const carried = logs + Math.floor(total(v.inv, 'oak_planks') / 4);
  const nothingNearby = !v.tree && !v.knownWood;

  // Enough oak is stored or carried for the house: stop chopping and help build.
  if (v.shortfall && v.shortfall.wood === 0) {
    const spareLogs = logs - (v.siteNeed?.oak_log || 0);
    if (spareLogs > 0 && (v.siteNeed?.oak_planks || 0) > total(v.inv, 'oak_planks')) {
      return { type: 'craft_planks', count: spareLogs * 4, wood: 'oak', say: 'Turning my spare oak logs into planks for the house' };
    }
    return helpBuild(v);
  }

  if (v.full || carried >= DEPOSIT_AT || (nothingNearby && carried >= 4)) {
    // Once storage already holds enough logs (as last seen), the rest become planks.
    const convertLogs = logs > 0 && !!v.storage && total(v.storage.contents, 'oak_log') >= LOG_RESERVE;
    return {
      type: 'deposit', keep: lumberjackKeep, convertLogs,
      say: convertLogs ? `Storage has enough logs; delivering ${logs} oak logs as planks` : `Delivering ${carried} oak to storage`,
    };
  }
  if (v.tree) return { type: 'chop', target: v.tree, say: `Chopping an oak tree (${carried}/${DEPOSIT_AT})` };
  if (v.knownWood) return { type: 'travel', target: v.knownWood, say: 'Heading to known oak trees' };
  return { type: 'explore', angle: v.angle, say: 'Searching for oak trees' };
}

export function configureMovements(movements) {
  movements.canDig = false;
}
