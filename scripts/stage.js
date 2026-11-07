// Stage the demo: find flat open ground near spawn, move the world spawn there (storage and the
// house follow it), dress the bots so their roles are recognisable, and teleport everyone over.
// Usage: npm run stage                 (search near the current spawn)
//        npm run stage -- 120 70 -40   (use these coordinates as the new spawn instead)
import mineflayer from 'mineflayer';
import vec3Module from 'vec3';
import { sendCommands } from './cmd.js';
import { ROSTER } from '../src/roster.js';
import { isSoft } from '../src/items.js';

const { Vec3 } = vec3Module;
const PLAYER = process.env.PLAYER_NAME || 'b_caul';
const SEARCH_RADIUS = 56;
// Ground that must be level and open: storage corner (±4 around spawn) plus the house (x 5..11, z -3..4).
const AREA = { minX: -4, maxX: 11, minZ: -4, maxZ: 5 };

// Outfits: dyed leather pieces (or a vanilla helmet) so each role reads at a glance.
const OUTFITS = {
  miner:      { head: 'iron_helmet', chest: 0x4a4a4a, legs: 0x2b3a67, feet: 0x5c3a1e, team: 'gray' },   // helmet + work clothes
  lumberjack: { head: 0xb02e26, chest: 0xb02e26, legs: 0x3c5a8c, feet: 0x5c3a1e, team: 'red' },          // red cap and shirt, jeans
  builder:    { head: 0xffd500, chest: 0xff7a00, legs: 0x4c5a6b, feet: 0x5c3a1e, team: 'gold' },         // hard hat and hi-vis vest
  crafter:    { head: null, chest: 0x7b3fa0, legs: 0x3b2a1a, feet: 0x3b2a1a, team: 'light_purple' },     // purple apron
  scout:      { head: 0x3f7a3a, chest: 0x5e7c3a, legs: 0x4a5a2a, feet: 0x3a2a1a, team: 'green' },        // camouflage
};
const PIECES = { head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots' };

function outfitCommands() {
  const commands = [];
  for (const { name, role } of ROSTER) {
    const outfit = OUTFITS[role];
    for (const [slot, piece] of Object.entries(PIECES)) {
      const value = outfit[slot];
      if (value == null) continue;
      const item = typeof value === 'string' ? value : `leather_${piece}[dyed_color={rgb:${value}}]`;
      commands.push(`item replace entity ${name} armor.${slot} with ${item}`);
    }
    commands.push(`team add ${role}`, `team modify ${role} color ${outfit.team}`, `team join ${role} ${name}`);
  }
  return commands;
}

function surveyorFindsSite() {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25565),
      username: 'Site_Surveyor', version: process.env.MC_VERSION || '1.21.1', auth: 'offline' });
    const fail = error => { bot.quit(); reject(error); };
    bot.once('error', fail);
    bot.once('kicked', reason => fail(new Error(`Kicked: ${JSON.stringify(reason)}`)));
    bot.once('spawn', async () => {
      try {
        await bot.waitForChunksToLoad();
        await new Promise(r => setTimeout(r, 1500));
        resolve(findFlatSite(bot));
      } catch (error) { reject(error); } finally { bot.quit(); }
    });
  });
}

/** Height and kind of the top solid block in each column, ignoring plants. */
function surfaceOf(bot, x, z, top) {
  for (let y = top; y > top - 80; y--) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return null;
    if (block.name === 'air' || block.name === 'cave_air') continue;
    if (/leaves/.test(block.name)) return { y, kind: 'tree' };
    if (/water|lava|ice/.test(block.name)) return { y, kind: 'liquid' };
    if (isSoft(block.name)) continue;
    if (/_log$/.test(block.name)) return { y, kind: 'tree' };
    return { y, kind: 'ground' };
  }
  return null;
}

function findFlatSite(bot) {
  const centre = bot.entity.position.floored();
  const top = Math.min(centre.y + 40, 300);
  const cache = new Map();
  const at = (x, z) => {
    const key = `${x},${z}`;
    if (!cache.has(key)) cache.set(key, surfaceOf(bot, x, z, top));
    return cache.get(key);
  };
  let best = null;
  for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx += 3) for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz += 3) {
    const ax = centre.x + dx, az = centre.z + dz;
    let min = Infinity, max = -Infinity, ok = true;
    for (let x = AREA.minX; x <= AREA.maxX && ok; x++) for (let z = AREA.minZ; z <= AREA.maxZ; z++) {
      const s = at(ax + x, az + z);
      if (!s || s.kind !== 'ground') { ok = false; break; }
      min = Math.min(min, s.y); max = Math.max(max, s.y);
    }
    if (!ok || max - min > 1) continue;
    // Trees within reach keep the lumberjack busy; count canopy columns in a 24-block ring.
    let trees = 0;
    for (let x = -24; x <= 24; x += 2) for (let z = -24; z <= 24; z += 2) if (at(ax + x, az + z)?.kind === 'tree') trees++;
    if (trees < 6) continue;
    const score = (max - min) * 10 + Math.hypot(dx, dz) / 10 - Math.min(trees, 40) / 8;
    if (!best || score < best.score) best = { x: ax, y: max + 1, z: az, score, flatness: max - min, trees };
  }
  if (!best) throw new Error('No flat open area with nearby trees found near spawn. Pass coordinates instead: npm run stage -- x y z');
  return best;
}

const coords = process.argv.slice(2).map(Number);
const site = coords.length === 3 && coords.every(Number.isInteger)
  ? { x: coords[0], y: coords[1], z: coords[2] }
  : await surveyorFindsSite();
console.log(`New spawn: ${site.x} ${site.y} ${site.z}${site.trees ? ` (height variation ${site.flatness}, ${site.trees} tree columns nearby)` : ''}`);

const { x, y, z } = site;
sendCommands([
  `setworldspawn ${x} ${y} ${z}`,
  'gamerule spawnRadius 0',
  'gamerule keepInventory true',      // a death does not cost a bot its tools, outfit or materials
  'gamerule doDaylightCycle false', 'time set day',
  'gamerule doWeatherCycle false', 'weather clear',
  'difficulty peaceful',              // no mobs interrupting the demo
  ...ROSTER.map(({ name }, i) => `tp ${name} ${x + 1 + i} ${y} ${z - 2}`),
  `tp ${PLAYER} ${x - 2} ${y + 3} ${z - 6}`,
  ...outfitCommands(),
  `say Demo staged: new spawn at ${x} ${y} ${z}. Storage goes here; the house goes 6 blocks east.`,
]);
console.log('Sent spawn, rules, teleports and outfits to the server. Bots that are offline will need `npm run stage -- ' + `${x} ${y} ${z}` + '` again once they join.');
