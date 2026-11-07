// LUMBERJACK: fells nearby oak trees, turns surplus logs into planks, and stocks shared storage.
// Only oak is chopped so the whole house is one wood. Tall trunks are reached from a temporary
// dirt pillar, which is always taken down again afterwards.
import { total } from '../items.js';
import { blueprintNeeds } from '../blueprint.js';
import { baseView, siteView, findTargets, rememberedTarget } from './common.js';
import { helpBuild } from './construction.js';
import { MAX_PILLAR } from '../skills.js';

export const DEPOSIT_AT = Number(process.env.LUMBERJACK_DEPOSIT || 16);
// Logs kept as logs in storage: the blueprint's log posts plus some for other agents' crafting.
export const LOG_RESERVE = (blueprintNeeds().oak_log || 0) + 8;
// The lumberjack ranges further from home than other agents when it runs out of nearby oak.
export const WOOD_RANGE = Number(process.env.LUMBERJACK_RANGE || 160);
// Dirt carried for pillars (a little spare, as the pillar is dug back up afterwards).
export const PILLAR_DIRT = MAX_PILLAR;
export const isOakLog = name => name === 'oak_log';

export const lumberjackKeep = name => (/_axe$/.test(name) ? 64 : name === 'dirt' ? PILLAR_DIRT : 0);

export function perceive(ctx) {
  const v = siteView(ctx, baseView(ctx));
  const y = ctx.bot.entity.position.y;
  const oak = findTargets(ctx, isOakLog, { maxDistance: 32 });
  // Trunks near our own height can be felled from the ground; higher logs need a pillar.
  v.tree = oak.find(p => p.y - y <= 3 && y - p.y <= 4) || null;
  v.tallTree = v.tree ? null : oak.find(p => p.y - y > 3 && p.y - y <= 3 + MAX_PILLAR) || null;
  v.knownWood = v.tree || v.tallTree ? null : rememberedTarget(ctx, 'Wood', false, WOOD_RANGE);
  v.fillerTarget = total(v.inv, 'filler') >= PILLAR_DIRT ? null
    : findTargets(ctx, name => name === 'dirt' || name === 'grass_block', { maxDistance: 12, exposed: true })[0] || null;
  return v;
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  const logs = total(v.inv, 'oak_log');
  const carried = logs + Math.floor(total(v.inv, 'oak_planks') / 4);
  const nothingNearby = !v.tree && !v.tallTree && !v.knownWood;

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
  if (v.tallTree) {
    if (total(v.inv, 'filler') >= PILLAR_DIRT) return { type: 'tower_chop', target: v.tallTree, say: 'Pillaring up to chop a tall oak' };
    if (v.fillerTarget) return { type: 'mine', target: v.fillerTarget, say: 'Digging dirt to pillar up a tall oak' };
  }
  if (v.knownWood) return { type: 'travel', target: v.knownWood, say: 'Heading to known oak trees' };
  return { type: 'explore', angle: v.angle, range: WOOD_RANGE, say: 'Searching further afield for oak trees' };
}

export function configureMovements(movements) {
  movements.canDig = false;
}
