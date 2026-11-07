// Shared conventions every agent derives independently from the world itself.
// Nothing here is sent between agents: each computes the same answer from the server's spawn point.
import vec3Module from 'vec3';
import { HOUSE, insideFootprint } from './blueprint.js';

export const { Vec3 } = vec3Module;

function parsePosition(text, label) {
  if (!text) return null;
  const parts = text.split(/[ ,]+/).map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isSafeInteger(n))) throw new Error(`${label} must be "x,y,z".`);
  return new Vec3(...parts);
}

const storageOverride = parsePosition(process.env.STORAGE_POS, 'STORAGE_POS');
const originOverride = parsePosition(process.env.BUILD_ORIGIN, 'BUILD_ORIGIN');

/** Shared storage lives beside the world spawn unless configured. */
export function storageAnchor(bot) {
  return storageOverride || bot.spawnPoint.floored();
}

/** The house is built a few blocks east of storage, at spawn height. */
export function buildOrigin(bot) {
  return originOverride || storageAnchor(bot).offset(6, 0, -2);
}

export const STORAGE_RADIUS = 4;

/** Areas no agent should dig through: the house site and the storage corner. */
export function isProtected(bot, pos) {
  const anchor = storageAnchor(bot);
  if (Math.abs(pos.x - anchor.x) <= STORAGE_RADIUS && Math.abs(pos.z - anchor.z) <= STORAGE_RADIUS &&
    Math.abs(pos.y - anchor.y) <= 3) return true;
  return insideFootprint(HOUSE, buildOrigin(bot), pos, 1);
}

export function storageChests(bot) {
  const anchor = storageAnchor(bot);
  const ids = ['chest', 'barrel'].map(name => bot.registry.blocksByName[name]?.id).filter(id => id != null);
  return bot.findBlocks({ point: anchor, matching: ids, maxDistance: STORAGE_RADIUS + 2, count: 8 })
    .map(position => bot.blockAt(position)).filter(Boolean);
}

export const toVec = p => Array.isArray(p) ? new Vec3(p[0], p[1], p[2]) : new Vec3(p.x, p.y, p.z);

/** Locations of a resource kind this agent observed or heard about, excluding ones it found exhausted. */
export function knownLocations(state, kind) {
  const exhausted = new Set(state.exhausted || []);
  return [...state.history, ...state.knowledge]
    .filter(event => event.kind === kind && !exhausted.has(event.position.join(',')))
    .map(event => event.position);
}

export function markExhausted(state, position) {
  state.exhausted = [...new Set([...(state.exhausted || []), position.join(',')])].slice(-128);
}

export function isDangerous(state, pos) {
  return [...state.history, ...state.knowledge].some(event => event.kind === 'Danger' &&
    pos.distanceTo(toVec(event.position)) < 6);
}

/** Nearest position from a list, or null. */
export function nearest(from, positions) {
  let best = null, bestDistance = Infinity;
  for (const p of positions) {
    const d = from.distanceTo(toVec(p));
    if (d < bestDistance) { best = p; bestDistance = d; }
  }
  return best;
}
