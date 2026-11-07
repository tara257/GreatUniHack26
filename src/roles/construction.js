// Placement rules shared by the builder and by any agent helping it.
// Pure: works only from the view produced by siteView() in common.js.
import { total, subtract } from '../items.js';
import { requirements, canSupply, cellKey, blueprintNeeds } from '../blueprint.js';
import { COMPONENTS } from '../plan.js';
import { STORAGE_STALE_MS } from './common.js';

// Every block the house is made of, and so worth holding on to or fetching.
export const BUILD_ITEMS = Object.keys(blueprintNeeds());
// Cells this high above the floor can't be reached standing on the floor inside (eye ~2.6 blocks up,
// reach ~4.4): the top roof stairs and the ridge need a pillar.
export const PILLAR_HEIGHT = 7;

export const free = v => cell => !v.failed.has(cellKey(cell));
export const isHigh = (v, cell) => cell.y - v.origin.y >= PILLAR_HEIGHT;

/** Materials the site still needs that this agent is not already carrying. */
export function outstanding(v) {
  return subtract(requirements([...v.report.missing, ...v.report.supports]), v.inv);
}

export const houseComplete = v => v.siteLoaded && !v.report.missing.length && !v.report.supports.length && !v.report.obstructed.length;

/**
 * A cell this agent can place right now from its own inventory, walking to it.
 * Helpers work from the other end of the list to stay out of the builder's way.
 */
export function nextPlacement(v, { helper = false } = {}) {
  const cells = helper ? [...v.placeable].reverse() : v.placeable;
  return cells.find(c => free(v)(c) && !isHigh(v, c) && canSupply(v.inv, c.material)) || null;
}

/** Fetch outstanding materials from storage when it might have them (optionally only some). */
export function fetchFromStorage(v, only = null) {
  const need = outstanding(v);
  if (!v.storageExists || !Object.keys(need).length) return null;
  const stale = !v.storage || v.storage.age > STORAGE_STALE_MS;
  const available = Object.keys(need).filter(item => item !== 'filler' && (!only || only.has(item)) &&
    (stale || total(v.storage.contents, item) > 0));
  if (!available.length) return null;
  return {
    type: 'withdraw', wants: available.map(item => ({ group: item, count: Math.min(need[item], 64) })),
    say: `Fetching ${available.map(i => i.replace('oak_', '')).join(', ')} from storage`,
  };
}

/** Craft a component the house still needs from oak planks we carry, if we have enough for a batch. */
export function craftFromCarried(v) {
  const need = outstanding(v);
  for (const { item, planks, makes } of COMPONENTS) {
    if (!need[item]) continue;
    const batches = Math.min(Math.ceil(need[item] / makes), Math.floor(total(v.inv, 'oak_planks') / planks));
    if (batches > 0) return { type: 'make', item, count: Math.min(need[item], batches * makes), say: `Crafting ${item.replace('oak_', 'oak ')} from my planks` };
  }
  return null;
}

/**
 * What a non-builder does once the team has collected everything: place blocks it holds,
 * fetch more from storage, or stand by near the site.
 */
export function helpBuild(v) {
  if (houseComplete(v)) return { type: 'done', say: 'The house is complete; nothing left to do' };
  if (!v.siteLoaded || v.distanceToSite > 24) return { type: 'travel', target: v.origin.offset(4, 0, -4), range: 3, say: 'Heading to the house to help the builder' };
  const cell = nextPlacement(v, { helper: true });
  if (cell) return { type: 'place', target: cell, group: cell.material, say: `Helping the builder: placing ${cell.material.replace('oak_', 'oak ')}` };
  // Hand over building materials we cannot place yet, so the builder can use them; fetch only what we can place now.
  const placeableNow = new Set(v.placeable.filter(c => free(v)(c) && !isHigh(v, c)).map(c => c.material));
  const idle = Object.keys(v.inv).filter(name => BUILD_ITEMS.includes(name) && !placeableNow.has(name));
  if (idle.length && v.storageExists) {
    return { type: 'deposit', keep: name => (idle.includes(name) ? 0 : 999), say: 'Helping the builder: storing materials it will need' };
  }
  const fetch = fetchFromStorage(v, placeableNow);
  if (fetch) return { ...fetch, say: `Helping the builder: ${fetch.say.toLowerCase()}` };
  return { type: 'wait', ms: 4000, say: 'Standing by to help the builder' };
}
