import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const serverDirectory = fileURLToPath(new URL('../.server/', import.meta.url));
export const version = '1.21.1';
const jarPath = `${serverDirectory}/server.jar`;
const metadataPath = `${serverDirectory}/download.json`;
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function getJSON(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!result.ok) throw new Error(`Download failed: ${result.status} ${url}`);
  return result.json();
}

export async function setupServer() {
  await mkdir(serverDirectory, { recursive: true });
  if (!(await exists(jarPath)) || !(await exists(metadataPath))) {
    console.log(`Downloading the official Minecraft Java ${version} server...`);
    const manifest = await getJSON('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find(item => item.id === version);
    if (!entry) throw new Error(`Minecraft ${version} is not in Mojang's manifest.`);
    const metadata = await getJSON(entry.url);
    const download = metadata.downloads.server;
    const response = await fetch(download.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Server download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (createHash('sha1').update(buffer).digest('hex') !== download.sha1) throw new Error('Server checksum mismatch.');
    await writeFile(`${jarPath}.tmp`, buffer);
    await rename(`${jarPath}.tmp`, jarPath);
    await writeFile(metadataPath, JSON.stringify({ version, ...download }, null, 2));
  } else {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (metadata.version !== version || createHash('sha1').update(await readFile(jarPath)).digest('hex') !== metadata.sha1) {
      throw new Error('Existing server does not match its verified download. Move .server/server.jar aside and rerun setup.');
    }
  }
  if (!(await exists(`${serverDirectory}/server.properties`))) {
    await writeFile(`${serverDirectory}/server.properties`, [
      'server-ip=127.0.0.1', 'server-port=25565', 'online-mode=false',
      'enforce-secure-profile=false', 'difficulty=easy', 'gamemode=survival',
      'max-players=8', 'view-distance=6', 'simulation-distance=4',
      'spawn-protection=0', 'enable-rcon=false', 'enable-query=false',
      'allow-flight=true', 'motd=GreatUniHack26 - Dragon Team',
      'level-name=dragon-team', 'sync-chunk-writes=true', '',
    ].join('\n'));
  }
  if (!(await exists(`${serverDirectory}/eula.txt`))) await writeFile(`${serverDirectory}/eula.txt`, 'eula=false\n');
  console.log(`Server ready in .server/ (Java Edition ${version}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupServer().catch(error => { console.error(error.message); process.exitCode = 1; });
}
