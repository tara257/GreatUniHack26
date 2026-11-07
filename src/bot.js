import mineflayer from 'mineflayer';
import pathfinderModule from 'mineflayer-pathfinder';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TeamChannel } from './channel.js';
import { Builder } from './builder.js';
import { TEAM, parseHome } from './house.js';

const { pathfinder, Movements, goals: { GoalNear } } = pathfinderModule;
const name = process.argv[2], index = Number(process.argv[3]);
if (TEAM[index] !== name) throw new Error('Start the team with npm run bots.');
const directory = resolve(process.env.BOT_STATE_DIR || '.state');
mkdirSync(directory, { recursive: true });
const stateFile = resolve(directory, `${name}.json`);
let state = { history: [], seen: [], knowledge: [], deaths: 0, running: false, placed: 0 };
if (existsSync(stateFile)) state = { ...state, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
if (process.env.HOUSE_ORIGIN) {
  state.home = parseHome(process.env.HOUSE_ORIGIN);
  if (!state.home) throw new Error('HOUSE_ORIGIN must be three valid integer coordinates, e.g. 190,72,118.');
}
const save = () => {
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${stateFile}.tmp`, stateFile);
};
let bot, channel, builder, spawned = false, stopping = false, reconnectTimer, taskTimer, chatTimer;
let chatTurn = false;
const log = text => console.log(`[${name}] ${text}`);
const chatQueue = [];
function say(text) {
  log(text);
  if (spawned && bot?._client?.state === 'play') {
    chatQueue.push(text.slice(0, 230));
    if (chatQueue.length > 5) chatQueue.shift();
  }
}

function control(command, player) {
  if (!spawned) return log('Waiting to join the local server.');
  if (command === 'help') return say('Commands: !team start | pause | status | stats | home X Y Z | comms off | comms on | come');
  if (command === 'status') return say(builder.status());
  if (command === 'stats') return say(builder.experience.summary());
  if (command.startsWith('home ')) {
    const home = parseHome(command.slice(5));
    if (!home) return say('Use !team home X Y Z with integer coordinates for the floor corner.');
    builder.cancel(); state.home = home; builder.lastProgress = Date.now(); save();
    return say(`Shared house plan set at ${home.join(' ')}. Choose flat, clear ground below the 5x5 floor.`);
  }
  if (command === 'start') {
    if (!state.home) return say('First choose our site: !team home X Y Z. Use the floor corner, one block above flat ground.');
    state.running = true; save();
    return say('Mission: build a house together, find food, and stay alive.');
  }
  if (command === 'pause') {
    state.running = false; builder.cancel(); save(); return builder.narrate('Paused');
  }
  if (command === 'comms off' || command === 'comms on') {
    channel.setOnline(command === 'comms on');
    return say(`Team communications ${channel.online ? 'restored; exchanging discoveries' : 'OFF; continuing with my own knowledge'}.`);
  }
  if (command === 'come' && player) {
    const entity = bot.players[player]?.entity;
    if (!entity) return say('I cannot see you nearby.');
    state.running = false; builder.cancel(); save();
    bot.pathfinder.setGoal(new GoalNear(entity.position.x, entity.position.y, entity.position.z, 3));
    return builder.narrate(`Coming to ${player}`);
  }
}

function connect() {
  if (stopping) return;
  bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25565),
    username: name, version: process.env.MC_VERSION || '1.21.1', auth: 'offline' });
  bot.loadPlugin(pathfinder);
  channel = new TeamChannel({ state, save, send: text => { if (spawned) { bot.chat(text); log(text); } },
    learn: event => {
      builder?.learn(event);
      log(`Learned ${event.kind.toLowerCase()} from ${event.sender}: ${event.position.join(', ')}`);
    } });
  builder = new Builder({ bot, state, channel, index, save, say, log });
  bot.on('spawn', () => {
    spawned = true;
    const movement = new Movements(bot);
    movement.canDig = true;
    // Allow a route out of natural hollows, but never tunnel through the house.
    movement.exclusionAreasBreak.push(block => /(_leaves$|^short_grass$|^tall_grass$|^fern$|^large_fern$|^dirt$|^grass_block$|^stone$|^gravel$)/.test(block.name) ? 0 : 100);
    movement.allow1by1towers = true;
    movement.allowParkour = false;
    movement.allowSprinting = false;
    // The roof is four blocks above the outside ground; bots must be able to leave it.
    movement.maxDropDown = 4;
    movement.canOpenDoors = true;
    movement.exclusionAreasStep.push(block => Math.min(40,builder.experience.risk([block.position.x,block.position.y,block.position.z])*4));
    movement.scafoldingBlocks = [bot.registry.itemsByName.dirt.id];
    movement.exclusionAreasPlace.push(block => {
      if (!state.home) return 0;
      const [x,,z] = state.home;
      return block.position.x >= x && block.position.x <= x+4 && block.position.z >= z && block.position.z <= z+4 ? 100 : 0;
    });
    bot.pathfinder.setMovements(movement);
    bot.pathfinder.thinkTimeout = 1500;
    say(`I am ${name}. We are building a house and surviving together. Type !team start or !team help.`);
    if (channel.online) chatQueue.push('[TEAM SYNC] Please resend your discoveries.');
    clearInterval(taskTimer); clearInterval(chatTimer);
    taskTimer = setInterval(() => builder.tick().catch(error => log(`Decision error: ${error.message}`)), 800 + index * 90);
    chatTimer = setInterval(() => {
      if (!spawned) return;
      chatTurn = !chatTurn;
      if (channel.online && channel.queue.length && (chatTurn || !chatQueue.length)) channel.tick();
      else if (chatQueue.length) {
        const message = chatQueue.shift();
        if (!message.startsWith('[TEAM ') || channel.online) bot.chat(message);
      }
    }, 1100);
  });
  bot.on('chat', (sender, message) => {
    if (sender === name) return;
    if (TEAM.includes(sender)) return void channel.receive(sender, message);
    if (message.startsWith('!team ')) control(message.slice(6).trim().toLowerCase(), sender);
  });
  bot.on('death', () => {
    builder.cancel('death'); spawned = false; state.deaths++;
    builder.rememberDeath();
    save(); log('Died. Remembered the location; respawning and replanning.');
  });
  bot.on('kicked', reason => log(`Server kicked me: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', error => log(`Connection error: ${error.message}`));
  bot.on('end', () => {
    builder.cancel(); spawned = false; chatQueue.length = 0;
    clearInterval(taskTimer); clearInterval(chatTimer);
    if (!stopping) { log('Disconnected. Retrying in 5 seconds.'); reconnectTimer = setTimeout(connect, 5000); }
  });
}

process.on('message', message => { if (message?.type === 'control') control(message.command); });
function shutdown() {
  stopping = true; state.running = false; builder?.cancel(); save();
  clearTimeout(reconnectTimer); clearInterval(taskTimer); clearInterval(chatTimer);
  bot?.quit('Team stopped');
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setTimeout(connect, index * 1800);
