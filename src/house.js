export const TEAM = ['Ember', 'Flint', 'Moss'];
export const keyOf = p => p.join(',');

export function parseHome(text) {
  const parts = text.trim().split(/[ ,]+/).map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n)) ||
      Math.abs(parts[0]) > 29_999_900 || Math.abs(parts[2]) > 29_999_900 || parts[1] < -60 || parts[1] > 310) return null;
  return parts;
}

// One agreed plan, not a shared live state: every agent inspects these blocks itself.
export function blueprint(origin) {
  const tasks = [];
  const add = (x, y, z, kind, phase) => tasks.push({
    position: origin.map((n, i) => n + [x, y, z][i]), kind, phase,
    owner: tasks.length % TEAM.length,
  });
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) add(x, 0, z, 'planks', 0);
  add(1, 1, 1, 'crafting_table', 1);
  for (let y = 1; y <= 2; y++) for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
    if ((x === 0 || x === 4 || z === 0 || z === 4) && !(x === 2 && z === 0)) add(x, y, z, 'planks', y + 1);
  }
  // Perimeter first so roof blocks always have a neighbouring support.
  const roof = [];
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) roof.push([x, z]);
  roof.sort((a, b) => Math.min(a[0], 4-a[0], a[1], 4-a[1]) - Math.min(b[0], 4-b[0], b[1], 4-b[1]));
  for (const [x, z] of roof) add(x, 3, z, 'planks', 4);
  add(2, 1, 0, 'door', 5);
  add(3, 1, 1, 'furnace', 6);
  add(2, 1, 2, 'torch', 7);
  return tasks;
}

export function matches(task, block) {
  if (!block) return false;
  if (task.kind === 'planks') return block.name.endsWith('_planks');
  if (task.kind === 'door') return block.name.endsWith('_door') && block.getProperties?.().half === 'lower';
  return block.name === task.kind;
}

export function progress(plan, blockAt) {
  const missing = plan.filter(t => !matches(t, blockAt(t.position)));
  return { missing, complete: plan.length - missing.length, total: plan.length,
    phase: missing.length ? Math.min(...missing.map(t => t.phase)) : Infinity };
}

export function selectTask({ missing, phase, index, stalledMs, unavailable = () => false, claimed = () => false }) {
  const candidates = missing.filter(t => t.phase === phase && !unavailable(t) && !claimed(t));
  return candidates.find(t => t.owner === index) || (stalledMs >= 20_000 ? candidates[index % candidates.length] : null) || null;
}

export const SAFE_FOOD = new Set(['apple', 'bread', 'carrot', 'baked_potato', 'beef', 'cooked_beef',
  'porkchop', 'cooked_porkchop', 'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'cod', 'cooked_cod',
  'salmon', 'cooked_salmon', 'cooked_chicken', 'melon_slice', 'sweet_berries']);

export function priority({ food, health, hasFood, threat, foodCount, complete, shelterReady = false, night = false }) {
  if (threat) return 'escape';
  if (hasFood && food < (health < 20 ? 20 : 18)) return 'eat';
  // A safe stationary bot can wait for daylight without spending hunger on a
  // speculative trip. Do not leave shelter just to fill a food reserve at night.
  if (night && shelterReady) return 'shelter';
  if (health <= 8 && food >= 18) return 'recover';
  if (food <= 12 || (health < 20 && food < 18 && !hasFood) || (complete && foodCount < 4)) return 'forage';
  if (health <= 6) return 'recover';
  return complete ? 'maintain' : 'build';
}
