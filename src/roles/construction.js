// Placement rules shared by the builder and by any agent helping it.
// Pure: works only from the view produced by siteView() in common.js.
import { total, subtract, GROUPS } from '../items.js';
import { requirements, canSupply, cellKey } from '../blueprint.js';
import { STORAGE_STALE_MS } from './common.js';

export const free = v => cell => !v.failed.has(cellKey(cell));

/** Materials the site still needs that this agent is not already carrying. */
export function outstanding(v) {
  return subtract(requirements([...v.report.missing, ...v.report.supports]), v.inv);
}

export const houseComplete = v => v.siteLoaded && !v.report.missing.length && !v.report.supports.length && !v.report.obstructed.length;

/** A cell this agent can place right now from its own inventory. Helpers work from the other end of the list. */
export function nextPlacement(v, { helper = false } = {}) {
  const cells = helper ? [...v.placeable].reverse() : v.placeable;
  return cells.find(c => free(v)(c) && canSupply(v.inv, c.material)) || null;
}

const BUILD_GROUPS = ['cobblestone', 'planks', 'log', 'door', 'glass_pane', 'stairs'];
const buildGroupOf = name => BUILD_GROUPS.find(group => GROUPS[group](name));

/** Fetch outstanding materials from storage when it might have them (optionally only some groups). */
export function fetchFromStorage(v, only = null) {
  const need = outstanding(v);
  if (!v.storageExists || !Object.keys(need).length) return null;
  const stale = !v.storage || v.storage.age > STORAGE_STALE_MS;
  const available = Object.keys(need).filter(group => group !== 'filler' && (!only || only.has(group)) &&
    (stale || total(v.storage.contents, group) > 0));
  if (!available.length) return null;
  return {
    type: 'withdraw', wants: available.map(group => ({ group, count: Math.min(need[group], 64) })),
    say: `Fetching ${available.join(', ')} from storage`,
  };
}

/**
 * What a non-builder does once the team has collected everything: place blocks it holds,
 * fetch more from storage, or stand by near the site.
 */
export function helpBuild(v) {
  if (houseComplete(v)) return { type: 'done', say: 'The house is complete; nothing left to do' };
  if (!v.siteLoaded || v.distanceToSite > 24) return { type: 'travel', target: v.origin.offset(2, 0, -4), range: 3, say: 'All resources gathered; heading to the house to help' };
  const cell = nextPlacement(v, { helper: true });
  if (cell) return { type: 'place', target: cell, group: cell.material, say: `Helping the builder: placing ${cell.material}` };
  // Hand over building materials we cannot place yet, so the builder can use them; fetch only what we can place now.
  const placeableNow = new Set(v.placeable.filter(free(v)).map(c => c.material));
  const idle = Object.keys(v.inv).filter(name => buildGroupOf(name) && !placeableNow.has(buildGroupOf(name)));
  if (idle.length && v.storageExists) {
    return { type: 'deposit', keep: name => (idle.includes(name) ? 0 : 999), say: 'Helping the builder: storing materials it will need' };
  }
  const fetch = fetchFromStorage(v, placeableNow);
  if (fetch) return { ...fetch, say: `Helping the builder: ${fetch.say.toLowerCase()}` };
  return { type: 'wait', ms: 4000, say: 'All resources gathered; standing by to help the builder' };
}
