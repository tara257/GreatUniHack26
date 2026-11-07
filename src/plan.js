// Pure arithmetic shared by roles: how much raw material the team still has to collect.
// Each agent runs this on its OWN observations (site survey, last look in storage, own inventory).
import { total } from './items.js';

export function merge(...maps) {
  const out = {};
  for (const map of maps) for (const [name, n] of Object.entries(map || {})) out[name] = (out[name] || 0) + n;
  return out;
}

/**
 * Raw materials still to collect.
 * siteNeed: blueprint materials not yet placed, e.g. { cobblestone: 25, planks: 45, log: 8, door: 1, ... }.
 * stock:    items known to be available (storage contents + own inventory).
 * Returns { cobblestone, wood } where wood is counted in logs (1 log = 4 planks).
 */
export function rawShortfall(siteNeed, stock, { furnaceNear = false } = {}) {
  const need = name => siteNeed[name] || 0;
  // Components the crafter still has to make, and the raw material each costs.
  const doorShort = need('door') > total(stock, 'door');
  const stairsShort = need('stairs') > total(stock, 'stairs');
  const glassShort = need('glass_pane') > total(stock, 'glass_pane') && total(stock, 'glass') < 6;

  const cobbleNeeded = need('cobblestone') + (glassShort && !furnaceNear ? 8 : 0);
  const logsNeeded = need('log');
  const planksNeeded = need('planks') + (doorShort ? 6 : 0) + (stairsShort ? 6 : 0) + (glassShort ? 4 : 0);

  const logs = total(stock, 'log');
  const spareLogs = Math.max(0, logs - logsNeeded);
  const plankGap = Math.max(0, planksNeeded - total(stock, 'planks') - 4 * spareLogs);
  return {
    cobblestone: Math.max(0, cobbleNeeded - total(stock, 'cobblestone')),
    wood: Math.max(0, logsNeeded - logs) + Math.ceil(plankGap / 4),
  };
}
