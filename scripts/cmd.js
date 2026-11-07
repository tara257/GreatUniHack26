// Send a console command to the running local server, e.g.  npm run cmd -- time set day
import { appendFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { inboxPath } from './setup-server.js';

export function sendCommands(commands) {
  if (!existsSync(inboxPath)) throw new Error('The server is not running (start it with npm run server).');
  appendFileSync(inboxPath, commands.map(command => `${command.replace(/^\//, '').trim()}\n`).join(''));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv.slice(2).join(' ').trim();
  if (!command) {
    console.log('Usage: npm run cmd -- <server command>   e.g. npm run cmd -- gamemode creative b_caul');
    process.exit(1);
  }
  sendCommands([command]);
  console.log(`Sent to server: ${command}`);
}
