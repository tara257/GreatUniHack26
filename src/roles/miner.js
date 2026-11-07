// MINER: makes its own pickaxe, mines stone, and returns cobblestone to shared storage.
import { total, bestPickaxeTier, plankPotential, isPickaxe, isLog, isPlanks } from '../items.js';
import { baseView, findTargets, rememberedTarget, STORAGE_STALE_MS } from './common.js';
import { findNearby } from '../skills.js';

export const DEPOSIT_AT = Number(process.env.MINER_DEPOSIT || 32);

// Hold back tools, a little wood and enough cobblestone to replace a broken pickaxe.
export function minerKeep(name) {
  if (isPickaxe(name) || /_(axe|shovel)$/.test(name)) return 64;
  if (isLog(name) || isPlanks(name)) return 64;
  if (name === 'stick') return 8;
  if (name === 'cobblestone') return 3;
  if (name === 'crafting_table') return 1;
  return 0;
}

export function perceive(ctx) {
  const v = baseView(ctx);
  v.tableNear = !!findNearby(ctx.bot, 'crafting_table');
  const tier = bestPickaxeTier(v.inv);
  if (tier > 0) {
    v.stone = findTargets(ctx, name => name === 'stone', { maxDistance: 24 })[0] || null;
    v.knownStone = v.stone ? null : rememberedTarget(ctx, 'Stone', false);
  } else {
    v.tree = findTargets(ctx, isLog, { maxDistance: 32 }).find(p => Math.abs(p.y - ctx.bot.entity.position.y) < 5) || null;
    v.knownWood = v.tree ? null : rememberedTarget(ctx, 'Wood', false);
  }
  return v;
}

function storageMayHave(v, group) {
  if (!v.storageExists) return false;
  if (!v.storage || v.storage.age > STORAGE_STALE_MS * 3) return true;
  return total(v.storage.contents, group) > 0;
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting before mining' };
  const cobble = total(v.inv, 'cobblestone');
  const tier = bestPickaxeTier(v.inv);
  const wood = plankPotential(v.inv) + 2 * total(v.inv, 'stick');
  const tableCost = v.tableNear ? 0 : 4;

  if (v.full || cobble >= DEPOSIT_AT) {
    if (v.storageExists || wood >= 12) return { type: 'deposit', keep: minerKeep, say: `Returning ${cobble} cobblestone to storage` };
    if (v.full) return { type: 'wait', ms: 5000, say: 'Inventory full; waiting for a storage chest at spawn' };
  }

  if (tier === 0) {
    if (wood >= 5 + tableCost) return { type: 'craft_tool', item: 'wooden_pickaxe', say: 'Crafting a wooden pickaxe' };
    if (storageMayHave(v, 'log') || storageMayHave(v, 'planks')) {
      return { type: 'withdraw', wants: [{ group: 'log', count: 3 }, { group: 'planks', count: 9 }], say: 'Fetching wood from storage for a pickaxe' };
    }
    if (v.tree) return { type: 'chop', target: v.tree, say: 'No pickaxe; chopping a tree for one' };
    if (v.knownWood) return { type: 'travel', target: v.knownWood, say: 'Heading to reported trees for pickaxe wood' };
    return { type: 'explore', angle: v.angle, say: 'Looking for a tree to make a pickaxe' };
  }

  if (tier < 2 && cobble >= 3 && wood >= 2 + tableCost) {
    return { type: 'craft_tool', item: 'stone_pickaxe', say: 'Upgrading to a stone pickaxe' };
  }
  if (v.stone) return { type: 'mine', target: v.stone, say: `Mining stone (${cobble}/${DEPOSIT_AT})` };
  if (v.knownStone) return { type: 'travel', target: v.knownStone, say: 'Heading to a known stone location' };
  return { type: 'explore', angle: v.angle, say: 'Searching for stone' };
}

// The miner may dig through terrain on its way to stone, but never through storage or the house site.
export function configureMovements(movements, bot, isProtected) {
  movements.canDig = true;
  movements.exclusionAreasBreak = [block => (isProtected(bot, block.position) ? 100 : 0)];
}
