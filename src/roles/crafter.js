// CRAFTER: works out which house components are still missing and crafts them from shared storage.
// Components (door, fence windows, roof stairs) are made from oak planks only.
import { total } from '../items.js';
import { merge, COMPONENTS, componentShortfall } from '../plan.js';
import { baseView, siteView, STORAGE_STALE_MS } from './common.js';
import { helpBuild } from './construction.js';

// Stairs are crafted in batches of up to this many, so the builder can start on the roof early.
export const STAIR_BATCH = 16;

export function perceive(ctx) {
  const v = siteView(ctx, baseView(ctx));
  v.need = v.siteNeed;
  return v;
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  if (v.full) return { type: 'deposit', keep: () => 0, say: 'Inventory full; emptying into storage' };
  if (!v.storageExists) return { type: 'wait', ms: 5000, say: 'Waiting for shared storage to exist' };
  if (!v.storage || v.storage.age > STORAGE_STALE_MS) return { type: 'inspect_storage', say: 'Checking storage against the blueprint' };

  const stock = merge(v.storage.contents, v.inv);
  const short = componentShortfall(v.need, stock);
  // Oak logs the house needs as posts are never turned into components.
  const spareLogs = Math.max(0, total(stock, 'oak_log') - (v.need.oak_log || 0));
  const planks = total(stock, 'oak_planks');
  const inputs = n => [{ group: 'oak_planks', count: n }, ...(planks < n ? [{ group: 'oak_log', count: Math.ceil((n - planks) / 4) }] : [])];

  // Components in priority order: door, then fence windows, then roof stairs.
  for (const { item, planks: perBatch, makes } of COMPONENTS) {
    const missing = short[item];
    if (!missing) continue;
    const wanted = item === 'oak_stairs' ? Math.min(missing, STAIR_BATCH) : missing;
    const affordable = Math.floor((planks + 4 * spareLogs) / perBatch);
    const batches = Math.min(Math.ceil(wanted / makes), affordable);
    if (batches <= 0) continue;
    const count = Math.min(missing, batches * makes);
    return {
      type: 'make', item, count, inputs: inputs(batches * perBatch), returnToStorage: true,
      say: `Crafting ${count} ${item.replace('oak_', 'oak ')} for the house`,
    };
  }

  // Planks for the walls, roof ends and ridge, from oak logs the posts do not need.
  const plankGap = (v.need.oak_planks || 0) - planks;
  if (plankGap > 0 && spareLogs > 0) {
    const count = Math.min(plankGap, spareLogs * 4);
    return { type: 'make', item: 'oak_planks', count, inputs: [{ group: 'oak_log', count: Math.ceil(count / 4) }], returnToStorage: true, say: `Converting spare oak logs into ${count} planks` };
  }

  // Nothing to craft right now: help place blocks rather than stand idle.
  if (v.report) return helpBuild(v);
  const blocked = Object.keys(short);
  return { type: 'wait', ms: 5000, say: blocked.length ? `Cannot craft ${blocked.join(', ')} yet; waiting for oak` : 'All components are stocked' };
}

export function configureMovements(movements) {
  movements.canDig = false;
}
