// Pure arithmetic shared by roles: crafted house components and how much raw material the team
// still has to collect. Each agent runs this on its OWN observations (site survey, last look in
// storage, own inventory). The house is all oak, so only oak counts as wood.

export function merge(...maps) {
  const out = {};
  for (const map of maps) for (const [name, n] of Object.entries(map || {})) out[name] = (out[name] || 0) + n;
  return out;
}

/**
 * Crafted components in priority order: the door closes the house, fences make the windows,
 * stairs form the roof. `planks` is the oak planks one batch costs (sticks for fences included:
 * 2 sticks come from 1 plank), `makes` how many items a batch yields.
 */
export const COMPONENTS = [
  { item: 'oak_door', planks: 6, makes: 3 },
  { item: 'oak_fence', planks: 5, makes: 3 },
  { item: 'oak_stairs', planks: 6, makes: 4 },
];

const n = (map, name) => map[name] || 0;

/** Components still to craft: needed at the site minus already made (in storage or carried). */
export function componentShortfall(siteNeed, stock) {
  const short = {};
  for (const { item } of COMPONENTS) {
    const missing = n(siteNeed, item) - n(stock, item);
    if (missing > 0) short[item] = missing;
  }
  return short;
}

/** Oak planks needed to craft the given component shortfall. */
export function componentPlanks(short) {
  return COMPONENTS.reduce((sum, c) => sum + (short[c.item] ? Math.ceil(short[c.item] / c.makes) * c.planks : 0), 0);
}

/**
 * Raw materials still to collect.
 * siteNeed: blueprint blocks not yet placed, e.g. { cobblestone: 128, oak_planks: 89, oak_stairs: 89, ... }.
 * stock:    items known to be available (storage contents + own inventory).
 * Returns { cobblestone, wood } where wood is counted in oak logs (1 log = 4 planks).
 */
export function rawShortfall(siteNeed, stock) {
  const logsNeeded = n(siteNeed, 'oak_log');
  const planksNeeded = n(siteNeed, 'oak_planks') + componentPlanks(componentShortfall(siteNeed, stock));
  const logs = n(stock, 'oak_log');
  const spareLogs = Math.max(0, logs - logsNeeded);
  const plankGap = Math.max(0, planksNeeded - n(stock, 'oak_planks') - 4 * spareLogs);
  return {
    cobblestone: Math.max(0, n(siteNeed, 'cobblestone') - n(stock, 'cobblestone')),
    wood: Math.max(0, logsNeeded - logs) + Math.ceil(plankGap / 4),
  };
}
