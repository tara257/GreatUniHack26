// Local operator launcher. It manages membership and human start/pause commands;
// each child still chooses its own gameplay actions, even if the relay is offline.
import { fork } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync,readFileSync,writeFileSync,renameSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectRoster } from './roster.js';
import { RosterManager } from './operator/roster-manager.js';
import { serveTeamControl } from './operator/team-control.js';

const directory=resolve('.state');mkdirSync(directory,{recursive:true});
const selectionFile=resolve(directory,'team-selection.json');
const initial=process.env.TEAM_ROLES?selectRoster().map(a=>a.role):existsSync(selectionFile)?JSON.parse(readFileSync(selectionFile,'utf8')):selectRoster().map(a=>a.role);
const agentEnvironment={...process.env};delete agentEnvironment.COMMS_OPERATOR_TOKEN;delete agentEnvironment.OPERATOR_TOKEN;
const manager=new RosterManager({
  spawn(member,{autostart}) {
    const child=fork(new URL('./agent.js',import.meta.url),[member.name],{stdio:['ignore','inherit','inherit','ipc'],env:{...agentEnvironment,BOT_AUTOSTART:autostart?'1':'0'},execArgv:[]});
    child.on('error',error=>console.error(`${member.name}: ${error.message}`));
    return child;
  },
  save(roles){writeFileSync(selectionFile+'.tmp',JSON.stringify(roles));renameSync(selectionFile+'.tmp',selectionFile);},
});
// Bind before spawning, so accidentally launching twice cannot create duplicate bots.
const control=await serveTeamControl(request=>request.action==='status'?manager.status():request.action==='roles'?manager.apply(request.roles):manager.command(request.action));
await manager.apply(initial,{autostart:process.env.BOT_AUTOSTART==='1'});
console.log(`\nTeam selected: ${initial.join(', ') || '(none)'}.`);
console.log('Choose roles in the dashboard, or use TEAM_ROLES=miner,builder npm run bots.');
console.log('Minecraft chat: !team start | pause | status');
console.log('Terminal: start | pause | status | comms off | comms on | roles miner,builder | quit');
console.log(`Peer transport: ${process.env.COMMS_TRANSPORT || 'websocket'}. Relay loss never pauses gameplay.`);
const input=createInterface({input:process.stdin,output:process.stdout});
input.on('line',line=>{
  const command=line.trim().toLowerCase();if(command==='quit')return void shutdown();
  if(command.startsWith('roles '))return void manager.apply(command.slice(6).split(',').map(s=>s.trim()).filter(Boolean)).catch(error=>console.error(error.message));
  try{manager.command(command);}catch(error){console.error(error.message);}
});
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;input.close();control.close();await manager.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
