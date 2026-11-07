import { fork } from 'node:child_process';
import { createInterface } from 'node:readline';

const names = ['Ember', 'Flint', 'Moss'];
const children = names.map((name, index) => fork(new URL('./bot.js', import.meta.url), [name, String(index)], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
}));

console.log('\nShelter team starting: Ember, Flint, Moss.');
console.log('Minecraft chat: !team help');
console.log('Terminal controls: start | pause | status | home X Y Z | comms off | comms on | quit');
console.log('Goal: build a shared house, gather food, and survive.\n');
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
