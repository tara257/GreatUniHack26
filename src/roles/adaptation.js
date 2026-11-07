import * as miner from './miner.js';
import * as lumberjack from './lumberjack.js';
import * as crafter from './crafter.js';
import { rawShortfall } from '../plan.js';
import { STORAGE_STALE_MS } from './common.js';

export const FALLBACK_DELAY = {scout:15000,builder:30000,crafter:45000,lumberjack:60000,miner:75000};
const idle = new Set(['wait','done','inspect_storage']);
export const fallbackActions = crafter.actions;

// Only local site/inventory/chest observations enter this decision. No roster,
// relay status or other agent's private memory is read to infer a failure.
export function fallbackNeed(memory, role, view, primary, now = Date.now()) {
  if (!view.siteNeed || !view.siteLoaded || view.lowHealth) return null;
  const needs = view.shortfall || rawShortfall(view.siteNeed,view.inv,{furnaceNear:view.furnaceNear});
  const values = {wood:needs.wood,stone:needs.cobblestone,components:(view.siteNeed.oak_door || 0)+(view.siteNeed.oak_fence || 0)+(view.siteNeed.oak_stairs || 0)};
  memory.shortages ??= {};
  for (const [kind,value] of Object.entries(values)) {
    const old=memory.shortages[kind];
    if (!value) delete memory.shortages[kind];
    else memory.shortages[kind]={value,since:!old || value<old.value?now:old.since};
  }
  if (!idle.has(primary.type) && role!=='scout') return null;
  const delay=FALLBACK_DELAY[role];
  const stalled=kind=>memory.shortages[kind] && now-memory.shortages[kind].since>=delay;
  if (view.storageExists && (!view.storage || view.storage.age>STORAGE_STALE_MS)) return 'inspect';
  if (role!=='lumberjack' && stalled('wood')) return 'wood';
  if (role!=='miner' && stalled('stone')) return 'stone';
  if (role!=='crafter' && !values.wood && !values.stone && stalled('components')) return 'components';
  return null;
}

export async function adapt(ctx, view, primary) {
  // (The Nordic cottage has fence windows, so the earlier glass/sand trip is no longer needed.)
  const need=fallbackNeed(ctx.memory,ctx.role,view,primary);
  if (!need) return primary;
  if (need==='inspect') return {type:'inspect_storage',say:'Checking supplies before deciding how to help'};
  const specialist={wood:lumberjack,stone:miner,components:crafter}[need];
  const action=specialist.decide(await specialist.perceive(ctx));
  return {...action,fallback:need,say:`Helping with ${need} shortage: ${action.say || action.type}`};
}
