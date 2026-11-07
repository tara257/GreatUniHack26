// Pure arithmetic shared by roles: crafted house components and how much raw material the team
// still has to collect. Each agent runs this on its OWN observations (site survey, last look in
// storage, own inventory). The house uses one wood type (HOUSE_WOOD), so only that wood counts.
import { wood } from './design.js';

export function merge(...maps) {
  const out = {};
  for (const map of maps) for (const [name, n] of Object.entries(map || {})) out[name] = (out[name] || 0) + n;
  return out;
}

/**
 * Crafted components in priority order: the door closes the house, windows next, then stairs.
 * `planks` is the house-wood planks one batch costs (fence sticks included: 2 sticks = 1 plank),
 * `glass` the glass blocks it costs, `makes` how many items a batch yields.
 */
export const COMPONENTS = [
  { item: wood('door'), planks: 6, makes: 3 },
  { item: wood('fence'), planks: 5, makes: 3 },
  { item: 'glass_pane', glass: 6, makes: 16 },
  { item: wood('stairs'), planks: 6, makes: 4 },
];
// Smelting 6 sand into glass for one batch of panes: a furnace (8 cobblestone) and fuel (4 planks).
export const GLASS_BATCH = 6, FURNACE_COBBLE = 8, FUEL_PLANKS = 4;

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

/** House-wood planks needed to craft the given component shortfall. */
export function componentPlanks(short) {
  return COMPONENTS.reduce((sum, c) => sum + (short[c.item] && c.planks ? Math.ceil(short[c.item] / c.makes) * c.planks : 0), 0);
}

/** Whether glass still has to be smelted for missing panes (not enough glass made yet). */
export const needsGlass = (siteNeed, stock) => !!componentShortfall(siteNeed, stock).glass_pane && n(stock, 'glass') < GLASS_BATCH;

/**
 * Raw materials still to collect.
 * siteNeed: blueprint blocks not yet placed, e.g. { cobblestone: 25, oak_planks: 45, glass_pane: 2, ... }.
 * stock:    items known to be available (storage contents + own inventory).
 * Returns { cobblestone, wood, sand }; wood is counted in house-wood logs (1 log = 4 planks).
 */
export function rawShortfall(siteNeed, stock, { furnaceNear = false } = {}) {
  const glass = needsGlass(siteNeed, stock);
  const logsNeeded = n(siteNeed, wood('log'));
  const planksNeeded = n(siteNeed, wood('planks')) + componentPlanks(componentShortfall(siteNeed, stock)) + (glass ? FUEL_PLANKS : 0);
  const logs = n(stock, wood('log'));
  const spareLogs = Math.max(0, logs - logsNeeded);
  const plankGap = Math.max(0, planksNeeded - n(stock, wood('planks')) - 4 * spareLogs);
  return {
    cobblestone: Math.max(0, n(siteNeed, 'cobblestone') + (glass && !furnaceNear ? FURNACE_COBBLE : 0) - n(stock, 'cobblestone')),
    wood: Math.max(0, logsNeeded - logs) + Math.ceil(plankGap / 4),
    sand: glass ? Math.max(0, GLASS_BATCH - n(stock, 'sand')) : 0,
  };
}
