// Launcher only: starts one independent process per agent and relays human operator commands.
// It never assigns tasks or shares world state between agents.
import { fork } from 'node:child_process';
import { createInterface } from 'node:readline';
import { selectRoster } from './roster.js';

const roster = selectRoster();
const children = roster.map(member => fork(new URL('./agent.js', import.meta.url), [member.name], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
}));

console.log(`\nTeam starting: ${roster.map(m => `${m.name} (${m.role})`).join(', ')}.`);
console.log('Minecraft chat: !team help');
console.log('Terminal controls: start | pause | status | comms off | comms on | quit');
console.log('Set TEAM_ROLES=all (or a comma-separated list) to change who joins.\n');
const input = createInterface({ input: process.stdin, output: process.stdout });
input.on('line', line => {
  const command = line.trim().toLowerCase();
  if (command === 'quit') return shutdown();
  for (const child of children) if (child.connected) child.send({ type: 'control', command });
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  input.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const child of children) child.on('exit', (code, signal) => {
  if (!stopping) console.error(`An agent stopped (${signal ?? code}). Restart the team to restore it from saved memory.`);
});
