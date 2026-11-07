// Stage the demo: find flat open ground near spawn, move the world spawn there (storage and the
// house follow it), dress the bots so their roles are recognisable, and teleport everyone over.
// Usage: npm run stage                         (search near the current spawn)
//        npm run stage -- 120 70 -40           (use these coordinates as the new spawn instead)
//        npm run stage -- biome cherry_grove   (find that biome anywhere and search there;
//                                               several names = try each in order)
import mineflayer from 'mineflayer';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vec3Module from 'vec3';
import { sendCommands } from './cmd.js';
import { ROSTER } from '../src/roster.js';
import { isSoft } from '../src/items.js';

const { Vec3 } = vec3Module;
const PLAYER = process.env.PLAYER_NAME || 'b_caul';
const SEARCH_RADIUS = 56;
// Ground that must be level and open: the house footprint with a one-block margin (x 5..11, z -3..4)
// and a small patch at spawn for the storage chest and crafting table.
const AREAS = [{ minX: 5, maxX: 11, minZ: -3, maxZ: 4 }, { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }];

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

const logPath = fileURLToPath(new URL('../.server/logs/latest.log', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ask the server where the nearest biome of a kind is, and read the answer from its log. */
async function locateBiome(biome) {
  const start = statSync(logPath).size;
  sendCommands([`locate biome minecraft:${biome}`]);
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const text = readFileSync(logPath, 'utf8').slice(start);
    const found = /The nearest minecraft:\w+ is at \[(-?\d+), (?:~|-?\d+), (-?\d+)\]/.exec(text);
    if (found) return { x: Number(found[1]), z: Number(found[2]) };
    if (/Could not find|Unknown|Incorrect/.test(text)) return null;
  }
  return null;
}

function surveyorFindsSite({ centre = null, biome = null } = {}) {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25565),
      username: 'Site_Surveyor', version: process.env.MC_VERSION || '1.21.1', auth: 'offline' });
    const fail = error => { bot.quit(); reject(error); };
    bot.once('error', fail);
    bot.once('kicked', reason => fail(new Error(`Kicked: ${JSON.stringify(reason)}`)));
    bot.once('spawn', async () => {
      try {
        if (centre) {
          // Fly over as a spectator so the surveyor can look at faraway terrain without falling.
          sendCommands([`gamemode spectator Site_Surveyor`, `tp Site_Surveyor ${centre.x} 200 ${centre.z}`]);
          for (let i = 0; i < 60 && bot.entity.position.distanceTo(new Vec3(centre.x, 200, centre.z)) > 4; i++) await sleep(500);
          await sleep(4000); // let the new chunks generate and arrive
        }
        await bot.waitForChunksToLoad();
        await sleep(1500);
        resolve(findFlatSite(bot, { biome, deep: !!centre }));
      } catch (error) { reject(error); } finally { bot.quit(); }
    });
  });
}

/** Height and kind of the top solid block in each column, ignoring plants. */
function surfaceOf(bot, x, z, top, depth = 80) {
  for (let y = top; y > top - depth; y--) {
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

function findFlatSite(bot, { biome = null, deep = false } = {}) {
  const centre = bot.entity.position.floored();
  // Surveying from the sky: scan the whole height range of normal terrain.
  const top = deep ? 200 : Math.min(centre.y + 40, 300);
  const depth = deep ? 150 : 80;
  const cache = new Map();
  const at = (x, z) => {
    const key = `${x},${z}`;
    if (!cache.has(key)) cache.set(key, surfaceOf(bot, x, z, top, depth));
    return cache.get(key);
  };
  let best = null;
  const why = { unloaded: 0, notGround: 0, uneven: 0, otherBiome: 0, fewTrees: 0 };
  const biomes = new Set();
  for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx += 3) for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz += 3) {
    const ax = centre.x + dx, az = centre.z + dz;
    let min = Infinity, max = -Infinity, ok = true;
    for (const area of AREAS) for (let x = area.minX; x <= area.maxX && ok; x++) for (let z = area.minZ; z <= area.maxZ; z++) {
      const s = at(ax + x, az + z);
      if (!s) { why.unloaded++; ok = false; break; }
      if (s.kind !== 'ground') { why.notGround++; ok = false; break; }
      min = Math.min(min, s.y); max = Math.max(max, s.y);
    }
    if (!ok) continue;
    if (max - min > 1) { why.uneven++; continue; }
    // The house itself must stand in the requested biome.
    const b = bot.blockAt(new Vec3(ax + 8, max + 1, az))?.biome;
    const here = b?.name || bot.registry.biomes?.[b?.id]?.name;
    biomes.add(here);
    if (biome && here !== biome) { why.otherBiome++; continue; }
    // Trees within reach keep the lumberjack busy; count canopy columns in a 24-block ring.
    let trees = 0;
    for (let x = -24; x <= 24; x += 2) for (let z = -24; z <= 24; z += 2) if (at(ax + x, az + z)?.kind === 'tree') trees++;
    if (trees < 6) { why.fewTrees++; continue; }
    const score = (max - min) * 10 + Math.hypot(dx, dz) / 10 - Math.min(trees, 40) / 8;
    if (!best || score < best.score) best = { x: ax, y: max + 1, z: az, score, flatness: max - min, trees };
  }
  if (!best) throw new Error(`No flat open area with nearby trees found around ${centre.x}, ${centre.z}. Rejected spots: ${JSON.stringify(why)}; biomes on flat ground: ${[...biomes].join(', ') || 'none'}`);
  return best;
}

const args = process.argv.slice(2);
const coords = args.map(Number);
let site;
if (args[0] === 'biome') {
  for (const biome of args.slice(1)) {
    const centre = await locateBiome(biome);
    if (!centre) { console.log(`No ${biome} found.`); continue; }
    console.log(`Nearest ${biome} is around ${centre.x}, ${centre.z}; surveying it...`);
    try { site = { ...(await surveyorFindsSite({ centre, biome })), biome }; break; }
    catch (error) { console.log(`  ${error.message}`); }
  }
  if (!site) { console.error('None of those biomes had a usable flat site.'); process.exit(1); }
} else if (coords.length === 3 && coords.every(Number.isInteger)) {
  site = { x: coords[0], y: coords[1], z: coords[2] };
} else {
  site = await surveyorFindsSite();
}
console.log(`New spawn: ${site.x} ${site.y} ${site.z}${site.biome ? ` in ${site.biome}` : ''}${site.trees ? ` (height variation ${site.flatness}, ${site.trees} tree columns nearby)` : ''}`);

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
