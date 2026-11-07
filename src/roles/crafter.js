// CRAFTER: works out which house components are still missing and crafts them from shared storage:
// the door, fences and stairs from house-wood planks, and glass panes from sand it collects and
// smelts into glass itself.
import { total } from '../items.js';
import { merge, COMPONENTS, componentShortfall, GLASS_BATCH, FURNACE_COBBLE, FUEL_PLANKS } from '../plan.js';
import { baseView, siteView, findTargets, rememberedTarget, STORAGE_STALE_MS } from './common.js';
import { helpBuild } from './construction.js';
import { wood, pretty } from '../design.js';

// Stairs are crafted in batches of up to this many, so the builder can start on the roof early.
export const STAIR_BATCH = 16;
export const SAND_RANGE = 160;

export function perceive(ctx) {
  const v = siteView(ctx, baseView(ctx));
  v.need = v.siteNeed;
  v.sand = findTargets(ctx, name => name === 'sand', { maxDistance: 32, exposed: true })[0] || null;
  v.knownSand = v.sand ? null : rememberedTarget(ctx, 'Sand', false, SAND_RANGE);
  return v;
}

/** Walk to and dig sand: visible sand first, then sand a teammate reported, else search. */
function fetchSand(v) {
  const have = total(v.inv, 'sand');
  if (v.sand) return { type: 'mine', target: v.sand, say: `Collecting sand for the glass windows (${have}/${GLASS_BATCH})` };
  if (v.knownSand) return { type: 'travel', target: v.knownSand, say: 'Heading to reported sand for the glass windows' };
  return { type: 'explore', angle: v.angle, range: SAND_RANGE, say: 'Searching for sand for the glass windows' };
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  if (v.full) return { type: 'deposit', keep: () => 0, say: 'Inventory full; emptying into storage' };
  // Finish a sand trip before going back to check storage, so a stale storage check never makes us
  // turn round halfway and commute back and forth.
  const sandHeld = total(v.inv, 'sand');
  if (sandHeld > 0 && sandHeld < GLASS_BATCH && (v.need.glass_pane || 0) > total(v.inv, 'glass_pane')) return fetchSand(v);
  if (!v.storageExists) return { type: 'wait', ms: 5000, say: 'Waiting for shared storage to exist' };
  if (!v.storage || v.storage.age > STORAGE_STALE_MS) return { type: 'inspect_storage', say: 'Checking storage against the blueprint' };

  const stock = merge(v.storage.contents, v.inv);
  const short = componentShortfall(v.need, stock);
  // Logs and cobblestone the house itself needs are never spent on components.
  const spareLogs = Math.max(0, total(stock, wood('log')) - (v.need[wood('log')] || 0));
  const spareCobble = Math.max(0, total(stock, 'cobblestone') - (v.need.cobblestone || 0));
  const planks = total(stock, wood('planks'));
  const plankInputs = n => [{ group: wood('planks'), count: n }, ...(planks < n ? [{ group: wood('log'), count: Math.ceil((n - planks) / 4) }] : [])];

  // Components in priority order: door, windows (fences or glass panes), then stairs.
  for (const { item, planks: perBatch, glass, makes } of COMPONENTS) {
    const missing = short[item];
    if (!missing) continue;

    if (glass) {
      if (total(stock, 'glass') >= glass) {
        return { type: 'make', item, count: missing, inputs: [{ group: 'glass', count: glass }], returnToStorage: true, say: 'Crafting glass panes for the windows' };
      }
      const furnaceOk = v.furnaceNear || spareCobble >= FURNACE_COBBLE;
      if (!furnaceOk) continue; // the miner's cobblestone will arrive; make other parts meanwhile
      if (total(stock, 'sand') >= GLASS_BATCH) {
        if (planks + 4 * spareLogs < FUEL_PLANKS) continue;
        const inputs = [{ group: 'sand', count: GLASS_BATCH }, ...plankInputs(FUEL_PLANKS)];
        if (!v.furnaceNear) inputs.push({ group: 'cobblestone', count: FURNACE_COBBLE });
        return { type: 'smelt_glass', count: GLASS_BATCH, inputs, say: 'Smelting sand into glass for the windows' };
      }
      return fetchSand(v);
    }

    const wanted = item === wood('stairs') ? Math.min(missing, STAIR_BATCH) : missing;
    const affordable = Math.floor((planks + 4 * spareLogs) / perBatch);
    const batches = Math.min(Math.ceil(wanted / makes), affordable);
    if (batches <= 0) continue;
    const count = Math.min(missing, batches * makes);
    return {
      type: 'make', item, count, inputs: plankInputs(batches * perBatch), returnToStorage: true,
      say: `Crafting ${count} ${pretty(item)} for the house`,
    };
  }

  // Planks for the walls and roof, from house-wood logs the posts do not need.
  const plankGap = (v.need[wood('planks')] || 0) - planks;
  if (plankGap > 0 && spareLogs > 0) {
    const count = Math.min(plankGap, spareLogs * 4);
    return { type: 'make', item: wood('planks'), count, inputs: [{ group: wood('log'), count: Math.ceil(count / 4) }], returnToStorage: true, say: `Converting spare logs into ${count} ${pretty(wood('planks'))}` };
  }

  // Nothing to craft right now: help place blocks rather than stand idle.
  if (v.report) return helpBuild(v);
  const blocked = Object.keys(short);
  return { type: 'wait', ms: 5000, say: blocked.length ? `Cannot craft ${blocked.map(pretty).join(', ')} yet` : 'All components are stocked' };
}

export function configureMovements(movements) {
  movements.canDig = false;
}
