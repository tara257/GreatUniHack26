// Predefined house blueprints and pure survey/planning functions.
// Coordinates are relative to the build origin: x east, y up, z south. The door faces north (-z).
//
// Two designs, chosen with HOUSE_DESIGN (see design.js); both use ONE wood type (HOUSE_WOOD):
// - starter: the original 5x5 house: cobblestone floor, log corners, plank walls and flat roof,
//   a door, two glass-pane windows and a front step (default).
// - nordic: a 9x11 cottage with a stair gable roof, a simplified design inspired by "Nordic Small
//   Home" by Harek319 on GrabCraft (https://www.grabcraft.com/minecraft/nordic-small-home/medieval-houses).
import { AIR, isEmpty, isSoft, isInteractive, total } from './items.js';
import { wood, DESIGN } from './design.js';

// Blueprint materials are exact block/item names, except these special ones.
const SPECIAL = {
  door_upper: name => name === wood('door'), // appears automatically when the lower door half is placed
  filler: name => !isSoft(name),              // anything solid under a floor that would otherwise float
  air: name => AIR.has(name),
};
const satisfies = (material, name) => (SPECIAL[material] ? SPECIAL[material](name) : name === material);
// Materials that are never placed directly.
const PASSIVE = new Set(['air', 'door_upper']);

// Each symbol: block name and, for stairs, the direction it must face. Wood blocks use the house wood.
const LEGEND = {
  C: { material: 'cobblestone' },
  L: { material: wood('log') },
  P: { material: wood('planks') },
  F: { material: wood('fence') },        // fence-post windows
  G: { material: 'glass_pane' },          // glass windows
  D: { material: wood('door') },
  U: { material: 'door_upper' },
  '>': { material: wood('stairs'), facing: 'east' },  // west roof slope, rising towards the ridge
  '<': { material: wood('stairs'), facing: 'west' },  // east roof slope
  v: { material: wood('stairs'), facing: 'south' },   // front step, climbing into the house
  '.': { material: 'air' },               // must be kept clear inside the house
  ' ': null,                               // not part of the blueprint
};

// ── Starter house (5x5): layers y = 0..3, rows z = -1..4, characters x = 0..4 ─────────────────
const STARTER_LAYERS = [
  // y = 0: floor and front step
  ['  v  ', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC'],
  // y = 1: walls, log corner posts, lower half of the door (north side)
  ['     ', 'LPDPL', 'P...P', 'P...P', 'P...P', 'LPPPL'],
  // y = 2: walls, upper door half, glass-pane windows east and west
  ['     ', 'LPUPL', 'P...P', 'G...G', 'P...P', 'LPPPL'],
  // y = 3: flat plank roof
  ['     ', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP'],
];

// ── Nordic cottage (9x11): layers y = 0..8, rows z = -1..10, characters x = 0..8 ──────────────
const WALL_ROWS = (posts, side, front, back) => ['         ', front, ...side.slice(0, 4), posts, ...side.slice(4), back];
const SIDES = fill => [...fill].map(ch => `${ch}.......${ch}`);
const roofLayer = (gable, slope) => ['         ', gable, ...Array(9).fill(slope), gable];
const NORDIC_LAYERS = [
  // y = 0: cobblestone floor and the front step
  ['    v    ', ...Array(11).fill('CCCCCCCCC')],
  // y = 1: cobblestone base course between log posts; door in the middle of the north wall
  WALL_ROWS('L.......L', SIDES('CCCCCCCC'), 'LCCCDCCCL', 'LCCCCCCCL'),
  // y = 2: plank walls with fence windows (two per side, one either side of the door, three at the back)
  WALL_ROWS('L.......L', SIDES('PFFPPFFP'), 'LPFPUPFPL', 'LPPFFFPPL'),
  // y = 3: top course of the walls
  WALL_ROWS('L.......L', SIDES('PPPPPPPP'), 'LPPPPPPPL', 'LPPPPPPPL'),
  // y = 4..7: gable roof of stairs; plank gable ends close the front and back
  roofLayer('>PPPPPPP<', '>       <'),
  roofLayer(' >PPPPP< ', ' >     < '),
  roofLayer('  >PPP<  ', '  >   <  '),
  roofLayer('   >P<   ', '   > <   '),
  // y = 8: plank ridge
  ['         ', ...Array(11).fill('    P    ')],
];

export function parseLayers(layers, legend = LEGEND) {
  const cells = [];
  layers.forEach((rows, y) => rows.forEach((row, r) => [...row].forEach((ch, x) => {
    if (!(ch in legend)) throw new Error(`Unknown blueprint symbol "${ch}" at layer ${y}, row ${r}`);
    if (legend[ch]) cells.push({ x, y, z: r - 1, ...legend[ch] });
  })));
  return cells;
}

export const STARTER = Object.freeze({
  name: 'starter-house',
  cells: Object.freeze(parseLayers(STARTER_LAYERS)),
  footprint: { minX: 0, maxX: 4, minZ: 0, maxZ: 4, minY: 0, maxY: 3 },
});
export const NORDIC = Object.freeze({
  name: 'nordic-cottage',
  cells: Object.freeze(parseLayers(NORDIC_LAYERS)),
  footprint: { minX: 0, maxX: 8, minZ: 0, maxZ: 10, minY: 0, maxY: 8 },
});
/** The house this team builds. */
export const HOUSE = { starter: STARTER, nordic: NORDIC }[DESIGN];

/**
 * Construction progress: share of required (non-air) blueprint blocks that are currently correct.
 * Air cells are excluded because they start out satisfied on a clear site.
 */
export function progress(report) {
  const solid = c => c.material !== 'air';
  const placed = report.complete.filter(solid).length;
  const required = placed + [...report.missing, ...report.obstructed, ...report.unknown].filter(solid).length;
  return { placed, required, percent: required ? Math.floor((100 * placed) / required) : 100 };
}

const NEIGHBOURS = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
const key = c => `${c.x},${c.y},${c.z}`;
export const cellKey = key;

// Total materials the blueprint needs, by item name.
export function blueprintNeeds(blueprint = HOUSE) {
  return requirements(blueprint.cells);
}

export function requirements(cells) {
  const need = {};
  for (const cell of cells) if (!PASSIVE.has(cell.material)) need[cell.material] = (need[cell.material] || 0) + 1;
  return need;
}

/**
 * Compare the world with the blueprint.
 * nameAt(x, y, z) returns the block name at an absolute position, or null if not loaded.
 * propsAt(x, y, z), if given, returns block state properties so stair directions can be checked;
 * a stair facing the wrong way (or upside down) is reported as an obstruction to dig out and replace.
 */
export function survey(blueprint, origin, nameAt, propsAt = null) {
  const result = { complete: [], missing: [], obstructed: [], supports: [], unknown: [] };
  for (const rel of blueprint.cells) {
    const cell = { ...rel, x: origin.x + rel.x, y: origin.y + rel.y, z: origin.z + rel.z };
    const name = nameAt(cell.x, cell.y, cell.z);
    if (name == null) { result.unknown.push(cell); continue; }
    if (satisfies(cell.material, name)) {
      const props = cell.facing && propsAt ? propsAt(cell.x, cell.y, cell.z) : null;
      if (props && (props.facing !== cell.facing || props.half === 'top')) {
        result.obstructed.push({ ...cell, found: `${name} facing ${props.facing}${props.half === 'top' ? ' upside down' : ''}` });
      } else result.complete.push(cell);
    } else if (cell.material === 'air' || !isEmpty(name)) result.obstructed.push({ ...cell, found: name });
    else result.missing.push(cell);
  }
  // Floor cells over a gap need something underneath before anything can attach to them.
  for (const cell of result.missing) {
    if (cell.y !== origin.y || hasSupport(cell, nameAt)) continue;
    const below = nameAt(cell.x, cell.y - 1, cell.z);
    if (below != null && isEmpty(below)) result.supports.push({ x: cell.x, y: cell.y - 1, z: cell.z, material: 'filler' });
  }
  return result;
}

export function hasSupport(cell, nameAt) {
  if (cell.material === wood('door')) {
    const below = nameAt(cell.x, cell.y - 1, cell.z);
    return below != null && !isSoft(below);
  }
  return NEIGHBOURS.some(([dx, dy, dz]) => {
    const name = nameAt(cell.x + dx, cell.y + dy, cell.z + dz);
    return name != null && !isSoft(name) && !isInteractive(name);
  });
}

/** Cells that can be placed right now, in a deterministic build order. */
export function placeable(report, origin, nameAt, blueprint = HOUSE) {
  const f = blueprint.footprint;
  const centre = { x: origin.x + (f.minX + f.maxX) / 2, z: origin.z + (f.minZ + f.maxZ) / 2 };
  const ring = c => Math.max(Math.abs(c.x - centre.x), Math.abs(c.z - centre.z));
  // The door goes in last: until then the doorway is the only way into the house, and the top of
  // the roof can only be reached from inside.
  const othersMissing = report.supports.length > 0 || report.missing.some(c => !PASSIVE.has(c.material) && c.material !== wood('door'));
  const candidates = [...report.supports, ...report.missing.filter(c => !PASSIVE.has(c.material) && !(othersMissing && c.material === wood('door')))];
  return candidates.filter(c => hasSupport(c, nameAt)).sort((a, b) =>
    (a.material === 'filler' ? -1 : 0) - (b.material === 'filler' ? -1 : 0) ||
    a.y - b.y ||
    // Floor grows outward from the centre so the next face stays reachable; higher layers work inward from the walls.
    (a.y === origin.y ? ring(a) - ring(b) : ring(b) - ring(a)) ||
    a.x - b.x || a.z - b.z);
}

/** Whether a held inventory can supply a blueprint material. */
export function canSupply(counts, material) {
  return total(counts, material) > 0;
}

export function insideFootprint(blueprint, origin, pos, margin = 0) {
  const f = blueprint.footprint;
  return pos.x >= origin.x + f.minX - margin && pos.x <= origin.x + f.maxX + margin &&
    pos.z >= origin.z + f.minZ - margin && pos.z <= origin.z + f.maxZ + margin &&
    pos.y >= origin.y + f.minY - 1 - margin && pos.y <= origin.y + f.maxY + 2 + margin;
}

