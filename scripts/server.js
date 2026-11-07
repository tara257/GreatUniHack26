import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { setupServer, serverDirectory } from './setup-server.js';

await setupServer();
if (!/^eula=true\s*$/m.test(await readFile(`${serverDirectory}/eula.txt`, 'utf8'))) {
  console.log('\nMojang requires acceptance of the Minecraft EULA before the server can run.');
  console.log('Read it at https://www.minecraft.net/eula');
  if (!process.stdin.isTTY) {
    console.error('Open Start Server.command to review and answer the EULA prompt.');
    process.exit(1);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('Do you accept the Minecraft EULA? Type yes to accept: ');
  prompt.close();
  if (answer.trim().toLowerCase() !== 'yes') process.exit(0);
  await writeFile(`${serverDirectory}/eula.txt`, 'eula=true\n');
}
const properties = await readFile(`${serverDirectory}/server.properties`, 'utf8');
if (!/^server-ip=127\.0\.0\.1\s*$/m.test(properties)) throw new Error('This local bot setup requires server-ip=127.0.0.1.');
// Find Java directly so a terminal opened before installation (stale PATH) still works.
function windowsJavas() {
  if (process.platform !== 'win32') return [];
  const found = [];
  if (process.env.JAVA_HOME) found.push(join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  for (const root of ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Java']) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter(d => /^(jdk|jre)-?21/.test(d)).sort().reverse()) found.push(join(root, dir, 'bin', 'java.exe'));
  }
  return found;
}
const java = process.env.JAVA_BIN || [
  '/opt/homebrew/opt/openjdk@21/bin/java', '/usr/local/opt/openjdk@21/bin/java', ...windowsJavas(),
].find(existsSync) || 'java';
console.log('\nJoin from Minecraft Java 1.21.1: Multiplayer > Direct Connection > localhost:25565');
console.log('Wait for "Done" below, then open Start Bots.command.');
console.log('To watch: enter "gamemode spectator YOUR_USERNAME" in this server terminal.');
console.log('To shut down cleanly: type stop in this server terminal.\n');
const child = spawn(java, ['-Xms1G', '-Xmx3G', '-jar', 'server.jar', 'nogui'], { cwd: serverDirectory, stdio: 'inherit' });
child.on('error', error => { console.error(`Cannot start Java: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
