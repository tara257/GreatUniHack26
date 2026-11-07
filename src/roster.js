// Fixed team identities. Each agent knows its own role; nobody assigns tasks at runtime.
export const ROSTER = [
  { name: 'Flint_Miner', role: 'miner' },
  { name: 'Moss_Lumberjack', role: 'lumberjack' },
  { name: 'Ember_Builder', role: 'builder' },
  { name: 'Sage_Crafter', role: 'crafter' },
  { name: 'Wren_Scout', role: 'scout' },
];
export const TEAM_NAMES = ROSTER.map(member => member.name);
export const ROLES = ROSTER.map(member => member.role);
// Crafter and scout are opt-in until the core three are confirmed in a live run.
export const DEFAULT_ROLES = ['miner', 'lumberjack', 'builder'];

export function selectRoster(spec = process.env.TEAM_ROLES) {
  const wanted = !spec ? DEFAULT_ROLES : spec.trim() === 'all' ? ROLES : spec.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter(role => !ROLES.includes(role));
  if (unknown.length) throw new Error(`Unknown role(s) in TEAM_ROLES: ${unknown.join(', ')}. Use ${ROLES.join(', ')} or all.`);
  return ROSTER.filter(member => wanted.includes(member.role));
}
