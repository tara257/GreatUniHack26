import mineflayer from 'mineflayer';
import pathfinderModule from 'mineflayer-pathfinder';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TeamChannel } from './channel.js';

const { pathfinder, Movements, goals: { GoalNear } } = pathfinderModule;
const names = ['Ember', 'Flint', 'Moss'];
const name = process.argv[2];
const index = Number(process.argv[3]);
if (!names.includes(name)) throw new Error('Start the team with npm run bots.');
const directory = resolve(process.env.BOT_STATE_DIR || '.state');
mkdirSync(directory, { recursive: true });
const stateFile = resolve(directory, `${name}.json`);
let state = { history: [], seen: [], knowledge: [], deaths: 0, running: false };
if (existsSync(stateFile)) state = { ...state, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
const save = () => {
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${stateFile}.tmp`, stateFile);
};
const targetCount = Number(process.env.WOOD_TARGET || 8);
if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 64) throw new Error('WOOD_TARGET must be 1–64.');
let bot, channel, spawned = false, stopping = false, activeTask = null, generation = 0;
let currentTask = 'Waiting for the world', reconnectTimer, taskTimer, chatTimer;
let lastNarration = '', announcedComplete = false;
const failedTargets = new Map();
const discovered = new Set(state.history.filter(e => e.kind === 'Wood').map(e => e.position.join(',')));
const log = text => console.log(`[${name}] ${text}`);
const chatQueue = [];
function say(text) {
  log(text);
  if (spawned && bot?._client?.state === 'play') chatQueue.push(text.slice(0, 230));
}
function narrate(text) {
  currentTask = text;
  if (text !== lastNarration) { lastNarration = text; say(text); }
}
function logCount() {
  return bot.inventory.items().filter(item => /(_log|_stem)$/.test(item.name)).reduce((sum, item) => sum + item.count, 0);
}

function control(command, player) {
  if (!spawned) return log('Waiting to join the local server.');
  if (command === 'help') return say('Commands: !team start | pause | status | comms off | comms on | come');
  if (command === 'status') return say(`${currentTask}. Wood ${logCount()}/${targetCount}, deaths ${state.deaths}, comms ${channel.online ? 'on' : 'OFF'}, learned ${state.knowledge.length}.`);
  if (command === 'start') { state.running = true; save(); return say('Mission: defeat the Ender Dragon. Starting with gathering wood.'); }
  if (command === 'pause') {
    state.running = false; generation++; bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates(); save();
    return narrate('Paused');
  }
  if (command === 'comms off' || command === 'comms on') {
    channel.setOnline(command === 'comms on');
    // Operator notices are visible to observers; agents never use them as knowledge.
    return say(`Team communications ${channel.online ? 'restored; exchanging discoveries' : 'OFF; continuing with my own knowledge'}.`);
  }
  if (command === 'come' && player) {
    const entity = bot.players[player]?.entity;
    if (!entity) return say('I cannot see you nearby.');
    state.running = false; generation++; bot.stopDigging(); save();
    bot.pathfinder.setGoal(new GoalNear(entity.position.x, entity.position.y, entity.position.z, 3));
    return narrate(`Coming to ${player}`);
  }
}

function connect() {
  if (stopping) return;
  bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25565),
    username: name, version: process.env.MC_VERSION || '1.21.1', auth: 'offline' });
  bot.loadPlugin(pathfinder);
  channel = new TeamChannel({ state, save, send: text => { if (spawned) { bot.chat(text); log(text); } },
    learn: event => log(`Learned ${event.kind.toLowerCase()} location from ${event.sender}: ${event.position.join(', ')}`) });
  bot.on('spawn', () => {
    spawned = true;
    const movement = new Movements(bot);
    movement.canDig = false;
    movement.allow1by1towers = false;
    movement.allowParkour = false;
    movement.allowSprinting = false;
    bot.pathfinder.setMovements(movement);
    bot.pathfinder.thinkTimeout = 3000;
    say(`Hello! I am ${name}. Our goal is the Ender Dragon. Type !team start to begin, or !team help.`);
    // Request facts we may have missed while disconnected from the game server.
    if (channel.online) chatQueue.push('[TEAM SYNC] Please resend your discoveries.');
    clearInterval(taskTimer); clearInterval(chatTimer);
    taskTimer = setInterval(work, 2000 + index * 200);
    chatTimer = setInterval(() => {
      if (!spawned) return;
      if (chatQueue.length) {
        const message = chatQueue.shift();
        if (!message.startsWith('[TEAM ') || channel.online) bot.chat(message);
      }
      else channel.tick();
    }, 1600);
  });
  bot.on('chat', (sender, message) => {
    if (sender === name) return;
    if (names.includes(sender)) return void channel.receive(sender, message);
    if (message.startsWith('!team ')) control(message.slice(6).trim().toLowerCase(), sender);
  });
  bot.on('death', () => {
    generation++; spawned = false; activeTask = null; state.deaths++;
    if (bot.entity) channel.publish('Danger', bot.entity.position);
    save(); log('Died. Saved the location; respawning with memory intact.');
  });
  bot.on('kicked', reason => log(`Server kicked me: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', error => log(`Connection error: ${error.message}`));
  bot.on('end', () => {
    generation++; spawned = false; activeTask = null; chatQueue.length = 0;
    clearInterval(taskTimer); clearInterval(chatTimer);
    if (!stopping) { log('Disconnected. Retrying in 5 seconds.'); reconnectTimer = setTimeout(connect, 5000); }
  });
}

function isDangerous(position) {
  return [...state.history, ...state.knowledge].some(event => event.kind === 'Danger' &&
    position.distanceTo({ x: event.position[0], y: event.position[1], z: event.position[2] }) < 6);
}

async function work() {
  if (!spawned || !state.running || activeTask || stopping) return;
  if (logCount() >= targetCount) {
    if (!announcedComplete) { announcedComplete = true; narrate('Wood milestone reached. Waiting for the next implemented skill'); }
    return;
  }
  announcedComplete = false;
  if (bot.health <= 6) return narrate('Low health; holding position');
  const task = Symbol('work');
  activeTask = task;
  const currentBot = bot;
  const token = generation;
  const stillCurrent = () => token === generation && activeTask === task && spawned && state.running;
  const cancel = () => { if (stillCurrent()) { currentBot.pathfinder.setGoal(null); currentBot.stopDigging(); } };
  let timeout;
  try {
    const positions = currentBot.findBlocks({ matching: block => block && /(_log|_stem)$/.test(block.name), maxDistance: 40, count: 48 });
    const now = Date.now();
    const candidates = positions.filter(p => (failedTargets.get(p.toString()) || 0) < now && !isDangerous(p));
    // Different preferences reduce overlap without requiring a leader or new messages.
    const preferences = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];
    candidates.sort((a, b) => {
      const score = p => {
        const dx = p.x - currentBot.entity.position.x, dz = p.z - currentBot.entity.position.z;
        return currentBot.entity.position.distanceTo(p) + 8 * (1 - Math.cos(Math.atan2(dz, dx) - preferences[index]));
      };
      return score(a) - score(b);
    });
    if (!candidates.length) {
      narrate('Searching nearby for trees');
      const p = currentBot.entity.position;
      const angle = preferences[index] + Math.random() * 0.8;
      const goal = new GoalNear(Math.floor(p.x + Math.cos(angle) * 12), Math.floor(p.y), Math.floor(p.z + Math.sin(angle) * 12), 3);
      timeout = setTimeout(cancel, 12000);
      await currentBot.pathfinder.goto(goal);
      return;
    }
    const position = candidates[0];
    const key = [position.x, position.y, position.z].join(',');
    if (!discovered.has(key)) {
      discovered.add(key); channel.publish('Wood', position);
    }
    narrate(`Gathering wood at ${key}`);
    failedTargets.set(position.toString(), now + 45000);
    timeout = setTimeout(cancel, 18000);
    await currentBot.pathfinder.goto(new GoalNear(position.x, position.y, position.z, 2));
    if (!stillCurrent()) return;
    const block = currentBot.blockAt(position);
    if (block && /(_log|_stem)$/.test(block.name) && currentBot.canDigBlock(block)) {
      await currentBot.dig(block);
      if (!stillCurrent()) return;
      // Walk to the dropped item; mining alone does not guarantee collection.
      await currentBot.pathfinder.goto(new GoalNear(position.x, position.y, position.z, 1));
    }
  } catch (error) {
    log(`Replanning: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    if (activeTask === task) activeTask = null;
  }
}

process.on('message', message => { if (message?.type === 'control') control(message.command); });
function shutdown() {
  stopping = true; state.running = false; save();
  clearTimeout(reconnectTimer); clearInterval(taskTimer); clearInterval(chatTimer);
  bot?.quit('Team stopped');
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setTimeout(connect, index * 1800);
