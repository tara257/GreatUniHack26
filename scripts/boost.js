// Speed the demo up without handing out any items: the bots still gather and craft everything themselves.
// Usage: npm run boost   (speed, haste and no hunger for every bot)
// Effects are cleared when a bot dies; run it again if that happens.
import { sendCommands } from './cmd.js';
import { ROSTER } from '../src/roster.js';

const commands = [];
for (const { name } of ROSTER) {
  commands.push(
    `effect give ${name} speed infinite 2 true`,      // faster walking (bots account for it in their physics)
    `effect give ${name} haste infinite 2 true`,      // faster digging and chopping
    `effect give ${name} saturation infinite 0 true`, // never hungry
  );
}
commands.push('say Boost applied: speed, haste and no hunger for every bot.');
sendCommands(commands);
console.log(`Sent ${commands.length} commands.`);
