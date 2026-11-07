// CRAFTER: works out which house components are still missing and crafts them from shared storage.
import { total, subtract } from '../items.js';
import { merge } from '../plan.js';
import { baseView, siteView, findTargets, rememberedTarget, STORAGE_STALE_MS } from './common.js';
import { helpBuild } from './construction.js';
import { withdraw, deposit, craft, craftWooden, convertLogs, smelt, counts } from '../skills.js';

// Components in the order they matter: the door and windows close the house, stairs are cosmetic.
export const PRIORITY = ['door', 'glass_pane', 'stairs', 'planks'];

export function perceive(ctx) {
  const v = siteView(ctx, baseView(ctx));
  v.need = v.siteNeed;
  v.sand = findTargets(ctx, name => name === 'sand', { maxDistance: 32, exposed: true })[0] || null;
  v.knownSand = v.sand ? null : rememberedTarget(ctx, 'Sand', false);
  return v;
}

export function decide(v) {
  if (v.lowHealth) return { type: 'rest', say: 'Low health; resting' };
  if (v.full) return { type: 'deposit', keep: () => 0, say: 'Inventory full; emptying into storage' };
  if (!v.storageExists) return { type: 'wait', ms: 5000, say: 'Waiting for shared storage to exist' };
  if (!v.storage || v.storage.age > STORAGE_STALE_MS) return { type: 'inspect_storage', say: 'Checking storage against the blueprint' };

  const stock = merge(v.storage.contents, v.inv);
  const short = subtract(v.need, stock);
  // Raw materials the blueprint itself needs are not spent on components.
  const spareLogs = Math.max(0, total(stock, 'log') - (v.need.log || 0));
  const spareCobble = Math.max(0, total(stock, 'cobblestone') - (v.need.cobblestone || 0));
  const planks = total(stock, 'planks');
  const woodFor = n => planks + 4 * spareLogs >= n;
  const woodInputs = n => [{ group: 'planks', count: n }, ...(planks < n ? [{ group: 'log', count: Math.ceil((n - planks) / 4) }] : [])];

  for (const component of PRIORITY) {
    const missing = short[component];
    if (!missing) continue;
    if (component === 'door' && woodFor(6)) {
      return { type: 'make', item: 'door', count: missing, inputs: woodInputs(6), say: `Crafting ${missing} door${missing > 1 ? 's' : ''}` };
    }
    if (component === 'stairs') {
      if (woodFor(6)) return { type: 'make', item: 'stairs', count: missing, inputs: woodInputs(6), say: 'Crafting stairs' };
      if (spareCobble >= 6) return { type: 'make', item: 'cobblestone_stairs', count: missing, inputs: [{ group: 'cobblestone', count: 6 }], say: 'Crafting cobblestone stairs' };
    }
    if (component === 'glass_pane') {
      const glass = total(stock, 'glass'), sand = total(stock, 'sand');
      if (glass >= 6) return { type: 'make', item: 'glass_pane', count: missing, inputs: [{ group: 'glass', count: 6 }], say: 'Crafting glass panes' };
      const furnaceOk = v.furnaceNear || spareCobble >= 8;
      const fuelOk = total(stock, 'coal') >= 1 || planks + 4 * spareLogs >= 4;
      if (sand >= 6 && furnaceOk && fuelOk) {
        const inputs = [{ group: 'sand', count: 6 }, total(stock, 'coal') ? { group: 'coal', count: 1 } : { group: 'planks', count: 4 }];
        if (!v.furnaceNear) inputs.push({ group: 'cobblestone', count: 8 });
        return { type: 'smelt_glass', count: 6, inputs, say: 'Smelting sand into glass' };
      }
      if (sand < 6 && furnaceOk) {
        if (v.sand) return { type: 'mine', target: v.sand, say: `Collecting sand for glass (${total(v.inv, 'sand')}/6)` };
        if (v.knownSand) return { type: 'travel', target: v.knownSand, say: 'Heading to reported sand for glass' };
      }
    }
    if (component === 'planks' && spareLogs > 0) {
      const count = Math.min(missing, spareLogs * 4);
      return { type: 'make', item: 'planks', count, inputs: [{ group: 'log', count: Math.ceil(count / 4) }], say: `Converting spare logs into ${count} planks` };
    }
  }
  // Nothing to craft right now: help place blocks rather than stand idle.
  if (v.report) return helpBuild(v);
  const blocked = PRIORITY.filter(c => short[c]);
  return { type: 'wait', ms: 5000, say: blocked.length ? `Cannot craft ${blocked.join(', ')} yet; waiting for materials` : 'All craftable components are stocked' };
}

async function gather(ctx, inputs) {
  const held = counts(ctx.bot);
  const wants = inputs.filter(i => total(held, i.group) < i.count).map(i => ({ group: i.group, count: i.count - total(held, i.group) }));
  if (wants.length) await withdraw(ctx, wants);
}

// Crafting happens beside storage; results and leftovers go straight back in.
export const actions = {
  async make(ctx, a) {
    await gather(ctx, a.inputs);
    if (a.item === 'door' || a.item === 'stairs') await craftWooden(ctx, a.item, a.count);
    else if (a.item === 'planks') await convertLogs(ctx, a.count);
    else await craft(ctx, a.item, a.count);
    await deposit(ctx, () => 0);
  },
  async smelt_glass(ctx, a) {
    await gather(ctx, a.inputs);
    await smelt(ctx, 'sand', a.count);
    await deposit(ctx, () => 0);
  },
};

export function configureMovements(movements) {
  movements.canDig = false;
}

