import net from 'node:net';
import { mkdirSync, chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ROLES } from '../roster.js';

const directory=fileURLToPath(new URL('../../.state/',import.meta.url));
export const TEAM_SOCKET=process.platform==='win32'?'\\\\.\\pipe\\colony-'+createHash('sha256').update(directory).digest('hex').slice(0,16):directory+'team.sock';
export function validateTeamRequest(request) {
  if (!request || !['status','roles','start','pause'].includes(request.action)) throw new Error('Unknown team control');
  if (request.action==='roles' && (!Array.isArray(request.roles) || request.roles.length>5 || new Set(request.roles).size!==request.roles.length || !request.roles.every(role=>ROLES.includes(role)))) throw new Error('Choose valid, unique colony roles');
  return request;
}
export function teamRequest(request,{socketPath=TEAM_SOCKET,timeoutMs=7000}={}) {
  validateTeamRequest(request);
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(socketPath);let data='',settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(result);};
    socket.setTimeout(timeoutMs,()=>finish(new Error('Team launcher timed out')));
    socket.on('connect',()=>socket.write(JSON.stringify(request)+'\n'));
    socket.on('data',chunk=>{data+=chunk;if(data.length>16000)return finish(new Error('Invalid launcher response'));if(!data.includes('\n'))return;try{const result=JSON.parse(data.split('\n')[0]);finish(result.error?new Error(result.error):null,result);}catch(error){finish(error);}});
    socket.on('error',()=>finish(new Error('Start the bot launcher with npm run bots to use roster controls')));
    socket.on('end',()=>{if(!settled)finish(new Error('Team launcher closed without a response'));});
  });
}
export async function serveTeamControl(handler,{socketPath=TEAM_SOCKET}={}) {
  mkdirSync(directory,{recursive:true});
  if(process.platform!=='win32' && existsSync(socketPath)) {
    if(!lstatSync(socketPath).isSocket())throw new Error('Refusing to replace a non-socket team-control file');
    const active=await teamRequest({action:'status'},{socketPath,timeoutMs:500}).then(()=>true,()=>false);
    if(active)throw new Error('A bot launcher is already running');
    unlinkSync(socketPath);
  }
  const server=net.createServer(socket=>{
    let data='',handled=false;socket.setTimeout(5000,()=>socket.destroy());socket.on('error',()=>{});
    socket.on('data',async chunk=>{
      if(handled)return;data+=chunk;
      if(data.length>2048){handled=true;socket.end(JSON.stringify({error:'Request too large'})+'\n');return;}
      if(!data.includes('\n'))return;handled=true;
      try {const result=await handler(validateTeamRequest(JSON.parse(data.split('\n')[0])));socket.end(JSON.stringify(result)+'\n');}
      catch(error){socket.end(JSON.stringify({error:error.message})+'\n');}
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  if(process.platform!=='win32')chmodSync(socketPath,0o600);
  return server;
}
