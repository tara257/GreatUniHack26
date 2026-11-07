// Pure item/block classification shared by every role. No bot access here.

export const isLog = name => /(_log|_stem)$/.test(name);
export const isPlanks = name => name.endsWith('_planks');
export const isDoor = name => name.endsWith('_door') && name !== 'iron_door';
export const isStairs = name => name.endsWith('_stairs');
export const isPickaxe = name => name.endsWith('_pickaxe');

// Item groups: a name the decision rules can reason about, and a test for real item names.
export const GROUPS = {
  cobblestone: name => name === 'cobblestone',
  planks: isPlanks,
  log: isLog,
  door: isDoor,
  stairs: isStairs,
  glass_pane: name => name === 'glass_pane',
  glass: name => name === 'glass',
  sand: name => name === 'sand',
  stick: name => name === 'stick',
  coal: name => name === 'coal' || name === 'charcoal',
  filler: name => name === 'cobblestone' || name === 'dirt',
};

export const AIR = new Set(['air', 'cave_air', 'void_air']);
export const LIQUID = new Set(['water', 'lava', 'bubble_column']);
const SOFT = /(^|_)(grass|fern|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|vine|dead_bush|snow|bush|sapling|mushroom|torch)$/;
export const isEmpty = name => AIR.has(name) || LIQUID.has(name);
// A block that cannot support a placed block next to it.
export const isSoft = name => isEmpty(name) || SOFT.test(name) || name === 'short_grass' || name === 'tall_grass';

// Blocks that react to a right-click (a door opens instead of a block being placed against it).
export const isInteractive = name => /(door|trapdoor|fence_gate|chest|barrel|crafting_table|furnace|smoker|button|lever|bed|anvil|shulker_box)$/.test(name);

export const PICKAXE_TIER = { wooden_pickaxe: 1, golden_pickaxe: 1, stone_pickaxe: 2, iron_pickaxe: 3, diamond_pickaxe: 4, netherite_pickaxe: 5 };

export function countItems(items) {
  const counts = {};
  for (const item of items) counts[item.name] = (counts[item.name] || 0) + item.count;
  return counts;
}

export function total(counts, group) {
  const test = typeof group === 'function' ? group : GROUPS[group];
  if (!test) throw new Error(`Unknown item group ${group}`);
  let sum = 0;
  for (const [name, count] of Object.entries(counts || {})) if (test(name)) sum += count;
  return sum;
}

export function bestPickaxeTier(counts) {
  return Math.max(0, ...Object.keys(counts).filter(isPickaxe).map(name => PICKAXE_TIER[name] || 0));
}

export const woodOf = name => name.replace(/^stripped_/, '').replace(/_(log|stem|planks|wood|hyphae)$/, '');
export const planksFor = logName => `${woodOf(logName)}_planks`;

// The most plentiful wood type held, so crafted doors/stairs match the planks used.
export function dominantWood(counts) {
  let best = null, bestCount = 0; const potential = {};
  for (const [name, count] of Object.entries(counts)) {
    if (!isPlanks(name) && !isLog(name)) continue;
    const wood = woodOf(name);
    potential[wood] = (potential[wood] || 0) + (isLog(name) ? count * 4 : count);
    if (potential[wood] > bestCount) { best = wood; bestCount = potential[wood]; }
  }
  return best;
}

// How many planks are reachable from planks plus convertible logs.
export const plankPotential = counts => total(counts, 'planks') + 4 * total(counts, 'log');

export function subtract(need, ...haves) {
  const out = {};
  for (const [group, count] of Object.entries(need)) {
    const remaining = count - haves.reduce((sum, have) => sum + total(have, group), 0);
    if (remaining > 0) out[group] = remaining;
  }
  return out;
}
