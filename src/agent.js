// One autonomous agent process. It connects to the server, keeps its own memory, and repeatedly:
//   perceive (local observations) -> decide (deterministic role rules) -> act (skills).
// No other process tells it what to do; teammates share facts through the selected transport.
import mineflayer from 'mineflayer';
import pathfinderModule from 'mineflayer-pathfinder';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TeamChannel } from './channel.js';
import { MinecraftChannel } from './comms/minecraft-channel.js';
import { ROSTER, TEAM_NAMES } from './roster.js';
import { run, Cancelled } from './skills.js';
import { isProtected } from './world.js';
import { reportOnce, keyOf } from './roles/common.js';
import { observeHouse } from './house-telemetry.js';
import { ProgressEvidence } from './progress-evidence.js';
import { installInventorySync } from './inventory-sync.js';
import { adapt, fallbackActions } from './roles/adaptation.js';
import { perceiveSurvival, survivalActions } from './survival.js';

const { pathfinder, Movements, goals: { GoalNear } } = pathfinderModule;
const name = process.argv[2];
const member = ROSTER.find(m => m.name === name);
if (!member) throw new Error('Start the team with npm run bots.');
const roleName = member.role;
const transport=process.env.COMMS_TRANSPORT || 'websocket';
if(!['websocket','chat'].includes(transport))throw new Error('COMMS_TRANSPORT must be websocket or chat');
const role = await import(`./roles/${roleName}.js`);
const index = ROSTER.indexOf(member);
// Each agent prefers a different compass direction, which spreads the team out without coordination.
const angle = index * 2 * Math.PI / ROSTER.length;

const directory = resolve(process.env.BOT_STATE_DIR || '.state');
mkdirSync(directory, { recursive: true });
const stateFile = resolve(directory, `${name}.json`);
let state = { history: [], seen: [], knowledge: [], reported: [], exhausted: [], deaths: 0, running: false };
if (existsSync(stateFile)) state = { ...state, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
if (process.env.BOT_AUTOSTART==='1') state.running=true;
const save = () => {
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${stateFile}.tmp`, stateFile);
};

// Runtime-only memory: recent failures and the last look inside storage.
const memory = { failed: new Map(), storage: null, window: null };
const progressEvidence = new ProgressEvidence();
let bot, channel, spawned = false, minecraftConnected = false, stopping = false, activeTask = null, generation = 0;
let currentTask = 'Waiting for the world', reconnectTimer, taskTimer, chatTimer, lastSignature = '';
let decisions=0,completedActions=0,commsTimer;
const log = text => console.log(`[${name}/${roleName}] ${text}`);
const chatQueue = [];

function say(text) {
  log(text);
  if (spawned && bot?._client?.state === 'play') chatQueue.push(text.slice(0, 230));
}
// Only chat when the kind of activity changes, not when a counter ticks up.
function narrate(text) {
  currentTask = text;
  const signature = text.replace(/-?\d+/g, '#');
  if (signature !== lastSignature) { lastSignature = signature; say(text); }
}

function inventorySummary() {
  const counts = {};
  for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] || 0) + item.count;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return top.length ? top.map(([n, c]) => `${c} ${n}`).join(', ') : 'nothing';
}

function observeForPeers() {
  const resources={};
  for(const item of bot?.inventory?.items() || [])resources[item.name]=(resources[item.name] || 0)+item.count;
  const position=bot?.entity?.position;
  return {resources,status:{minecraft:{connected:minecraftConnected && !stopping},
    task:currentTask.slice(0,256),role:roleName,
    progress:progressEvidence.snapshot(),
    ...(roleName==='builder' && minecraftConnected?{house:observeHouse(bot)}:{}),
    ...(Number.isFinite(bot?.health)?{health:Math.max(0,Math.min(20,bot.health))}:{}),
    ...(Number.isFinite(bot?.food)?{hunger:Math.max(0,Math.min(20,bot.food))}:{}),
    ...(position && [position.x,position.y,position.z].every(Number.isFinite)?{position:{x:position.x,y:position.y,z:position.z}}:{}),
    details:{running:state.running,decisions,completedActions,deaths:state.deaths,learned:state.knowledge.length,
      transport,simulated:false}}};
}

function halt() {
  generation++;
  bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates();
  try { memory.window?.close(); } catch { /* window already gone */ }
  memory.window = null;
}

function control(command, player) {
  if (!spawned && ['start','pause'].includes(command)) {
    state.running=command==='start';save();return log(state.running?'Will start work after joining':'Will join paused');
  }
  if (!spawned) return log('Waiting to join the local server.');
  if (command === 'help') return say('Commands: !team start | pause | status | comms off | comms on | come');
  if (command === 'status') return say(`${roleName}: ${currentTask}. Carrying ${inventorySummary()}. Deaths ${state.deaths}, comms ${channel.summary ?? (channel.online ? 'on' : 'OFF')}, learned ${state.knowledge.length}.`);
  if (command === 'start') { state.running = true; save(); lastSignature = ''; return say(`Starting work as the ${roleName}.`); }
  if (command === 'pause') { state.running = false; halt(); save(); return narrate('Paused'); }
  if (command === 'comms off' || command === 'comms on') {
    channel.setOnline(command === 'comms on');
    // Operator notices are visible to observers; agents never use them as knowledge.
    return say(`Team communications ${channel.online ? 'restored; exchanging discoveries' : 'OFF; continuing with my own knowledge'}.`);
  }
  if (command === 'come' && player) {
    const entity = bot.players[player]?.entity;
    if (!entity) return say('I cannot see you nearby.');
    state.running = false; halt(); save();
    bot.pathfinder.setGoal(new GoalNear(entity.position.x, entity.position.y, entity.position.z, 3));
    return narrate(`Coming to ${player}`);
  }
}

function connect() {
  if (stopping) return;
  bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25565),
    username: name, version: process.env.MC_VERSION || '1.21.1', auth: 'offline' });
  bot.loadPlugin(pathfinder);
  bot.on('spawn', () => {
    installInventorySync(bot);
    spawned = true;minecraftConnected=true;
    currentTask = state.running ? 'Starting work' : 'Paused — ready to start';
    const movements = new Movements(bot);
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = true;
    movements.maxDropDown = 2;
    movements.canOpenDoors = true; // so nobody is shut inside the finished house
    for (const block of ['chest', 'barrel', 'crafting_table', 'furnace']) {
      const id = bot.registry.blocksByName[block]?.id;
      if (id != null) movements.blocksCantBreak.add(id);
    }
    role.configureMovements?.(movements, bot, isProtected);
    movements.exclusionAreasBreak = [block => isProtected(bot,block.position) ? 100 : 0];
    memory.movements=movements;
    bot.pathfinder.setMovements(movements);
    bot.pathfinder.thinkTimeout = 3000;
    say(`Hello! I am ${name}, the team ${roleName}. Type !team start to begin, or !team help.`);
    // Request facts we may have missed while disconnected from the game server.
    if (transport==='chat' && channel.online) chatQueue.push('[TEAM SYNC] Please resend your discoveries.');
    if(transport==='websocket')channel.tick();
    clearInterval(taskTimer); clearInterval(chatTimer);
    taskTimer = setInterval(work, 600 + index * 50);
    chatTimer = setInterval(() => {
      if (!spawned) return;
      if (chatQueue.length) {
        const message = chatQueue.shift();
        if (!message.startsWith('[TEAM ') || channel.online) bot.chat(message);
      } else if(transport==='chat')channel.tick();
    }, 1600);
  });
  bot.on('chat', (sender, message) => {
    if (sender === name) return;
    if (TEAM_NAMES.includes(sender)) return void channel.receive(sender, message);
    if (message.startsWith('!team ')) control(message.slice(6).trim().toLowerCase(), sender);
  });
  bot.on('death', () => {
    currentTask = 'Respawning';
    generation++; spawned = false; activeTask = null; state.deaths++;
    if (bot.entity) channel.publish('Danger', bot.entity.position);
    save(); log('Died. Saved the location; respawning with memory intact.');
  });
  bot.on('kicked', reason => log(`Server kicked me: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', error => log(`Connection error: ${error.message}`));
  bot.on('end', () => {
    currentTask = stopping ? 'Stopped' : 'Reconnecting to Minecraft';
    generation++; spawned = false; minecraftConnected=false;activeTask = null; chatQueue.length = 0; memory.window = null;
    clearInterval(taskTimer); clearInterval(chatTimer);
    if(transport==='websocket')channel.tick();
    if (!stopping) { log('Disconnected. Retrying in 5 seconds.'); reconnectTimer = setTimeout(connect, 5000); }
  });
}

async function work() {
  if (!spawned || !state.running || activeTask || stopping || !bot.entity) return;
  const task = Symbol('work');
  activeTask = task;
  const token = generation;
  const ctx = {
    bot, state, save, memory, role: roleName, angle, log, narrate, evidence:progressEvidence, observationTicket:progressEvidence.begin(),
    alive: () => token === generation && activeTask === task && spawned && state.running,
    publish: (kind, position) => channel.publish(kind, position),
    roleActions: {...fallbackActions,...role.actions,...survivalActions},
  };
  let action;
  try {
    const view = await role.perceive(ctx);
    // Share first sightings of resources so teammates can use them (only when comms are up).
    for (const [kind, field] of [['Wood', 'tree'], ['Stone', 'stone'], ['Sand', 'sand']]) {
      if (view[field]) reportOnce(ctx, kind, view[field]);
    }
    action = perceiveSurvival(ctx) || await adapt(ctx,view,role.decide(view));decisions++;
    if(action.localGoal==='sand')memory.gatheringSand=true;
    memory.movements.allowSprinting = bot.food>16 && bot.health>10;
    // Every role may clear a blocked route, but the house and utilities remain protected.
    memory.movements.canDig = true;
    narrate(action.say || action.type);
    await run(ctx, action);completedActions++;
  } catch (error) {
    if (error instanceof Cancelled || !ctx.alive()) return;
    log(`Replanning after ${action?.type ?? 'perception'}: ${error.message}`);
    // Avoid retrying the same target immediately; other options get a turn.
    if (action?.target) memory.failed.set(keyOf(action.target), Date.now() + 30000);
    if (action?.entityId) memory.failed.set('entity:'+action.entityId,Date.now()+30000);
    if (action?.type==='explore') memory.exploreTurn=(memory.exploreTurn || 0)+1;
    if (action && ['deposit', 'withdraw', 'inspect_storage'].includes(action.type)) memory.storage = { contents: {}, at: Date.now() };
  } finally {
    if (activeTask === task) activeTask = null;
  }
}

process.on('message', message => { if (message?.type === 'control') control(message.command); });
function shutdown() {
  stopping = true; state.running = false; save();
  clearTimeout(reconnectTimer); clearInterval(taskTimer); clearInterval(chatTimer);
  clearInterval(commsTimer);
  bot?.quit('Team stopped');
  setTimeout(()=>{channel.tick?.();channel.close?.();},100).unref();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
const channelOptions={state,save,learn:event=>log(`Learned ${event.kind.toLowerCase()} location from ${event.sender}: ${event.position.join(', ')}`)};
channel=transport==='websocket'?new MinecraftChannel({...channelOptions,agentId:name,observe:observeForPeers,log,notice:say,
  onEvidenceWindow:id=>progressEvidence.setWindow(id),
  url:process.env.COMMS_URL,token:process.env.COMMS_AGENT_TOKEN}):
  new TeamChannel({...channelOptions,send:text=>{if(spawned){bot.chat(text);log(text);}}});
if(transport==='websocket')commsTimer=setInterval(()=>channel.tick(),2000);
setTimeout(connect, index * 1800);
