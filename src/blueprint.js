// Predefined house blueprint and pure survey/planning functions.
// Coordinates are relative to the build origin: x east, y up, z south. The door faces north (-z).
import { GROUPS, AIR, isEmpty, isSoft, isInteractive, total } from './items.js';

// Which placed block satisfies each blueprint material.
const BLOCK_TEST = {
  cobblestone: GROUPS.cobblestone,
  planks: GROUPS.planks,
  log: GROUPS.log,
  door: GROUPS.door,
  door_upper: GROUPS.door, // appears automatically when the lower door half is placed
  glass_pane: GROUPS.glass_pane,
  stairs: GROUPS.stairs,
  filler: name => !isSoft(name),
  air: name => AIR.has(name),
};
// Materials that cannot be placed directly.
const PASSIVE = new Set(['air', 'door_upper']);

// The house, drawn layer by layer from the floor up (y = 0..3).
// In each layer, rows run north to south (z = -1..4) and characters west to east (x = 0..4).
// The first row (z = -1) is outside the walls and only holds the front step.
const LEGEND = {
  C: 'cobblestone', L: 'log', P: 'planks', D: 'door', U: 'door_upper',
  G: 'glass_pane', S: 'stairs', '.': 'air', // '.' = must be kept clear inside the house
  ' ': null,                                 // ' ' = not part of the blueprint
};
const LAYERS = [
  [ // y = 0: floor and front step
    '  S  ',
    'CCCCC',
    'CCCCC',
    'CCCCC',
    'CCCCC',
    'CCCCC',
  ],
  [ // y = 1: walls, log corner posts, lower half of the door (north side)
    '     ',
    'LPDPL',
    'P...P',
    'P...P',
    'P...P',
    'LPPPL',
  ],
  [ // y = 2: walls, upper door half, glass-pane windows east and west
    '     ',
    'LPUPL',
    'P...P',
    'G...G',
    'P...P',
    'LPPPL',
  ],
  [ // y = 3: flat plank roof
    '     ',
    'PPPPP',
    'PPPPP',
    'PPPPP',
    'PPPPP',
    'PPPPP',
  ],
];

export function parseLayers(layers, legend = LEGEND) {
  const cells = [];
  layers.forEach((rows, y) => rows.forEach((row, r) => [...row].forEach((ch, x) => {
    if (!(ch in legend)) throw new Error(`Unknown blueprint symbol "${ch}" at layer ${y}, row ${r}`);
    if (legend[ch]) cells.push({ x, y, z: r - 1, material: legend[ch] });
  })));
  return cells;
}

export const HOUSE = Object.freeze({
  name: 'starter-house',
  cells: Object.freeze(parseLayers(LAYERS)),
  footprint: { minX: 0, maxX: 4, minZ: 0, maxZ: 4, minY: 0, maxY: 3 },
});

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

// Total materials the blueprint needs, as item groups.
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
 */
export function survey(blueprint, origin, nameAt) {
  const result = { complete: [], missing: [], obstructed: [], supports: [], unknown: [] };
  for (const rel of blueprint.cells) {
    const cell = { ...rel, x: origin.x + rel.x, y: origin.y + rel.y, z: origin.z + rel.z };
    const name = nameAt(cell.x, cell.y, cell.z);
    if (name == null) { result.unknown.push(cell); continue; }
    if (BLOCK_TEST[cell.material](name)) result.complete.push(cell);
    else if (cell.material === 'air' || !isEmpty(name)) result.obstructed.push({ ...cell, found: name });
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
  if (cell.material === 'door') {
    const below = nameAt(cell.x, cell.y - 1, cell.z);
    return below != null && !isSoft(below);
  }
  return NEIGHBOURS.some(([dx, dy, dz]) => {
    const name = nameAt(cell.x + dx, cell.y + dy, cell.z + dz);
    return name != null && !isSoft(name) && !isInteractive(name);
  });
}

/** Cells that can be placed right now, in a deterministic build order. */
export function placeable(report, origin, nameAt) {
  const centre = { x: origin.x + 2, z: origin.z + 2 };
  const ring = c => Math.max(Math.abs(c.x - centre.x), Math.abs(c.z - centre.z));
  const candidates = [...report.supports, ...report.missing.filter(c => !PASSIVE.has(c.material))];
  return candidates.filter(c => hasSupport(c, nameAt)).sort((a, b) =>
    (a.material === 'filler' ? -1 : 0) - (b.material === 'filler' ? -1 : 0) ||
    a.y - b.y ||
    // Floor grows outward from the centre so the next face stays visible; the roof grows inward from the walls.
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
