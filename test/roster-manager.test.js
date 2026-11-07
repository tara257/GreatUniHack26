import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RosterManager } from '../src/operator/roster-manager.js';
import { serveTeamControl,teamRequest,validateTeamRequest } from '../src/operator/team-control.js';
import { fixture } from './comms/helpers.js';

test('roster changes retain existing agents, stop deselected agents and start only new roles',async()=>{
  const spawned=[],saved=[];
  const manager=new RosterManager({spawn:(member,options)=>{const child=new EventEmitter();child.connected=true;child.send=m=>child.lastCommand=m;child.kill=()=>queueMicrotask(()=>child.emit('exit',0));spawned.push({member,options,child});return child;},save:r=>saved.push(r)});
  await manager.apply(['miner','builder'],{autostart:false});const miner=manager.children.get('miner');
  await manager.apply(['miner','crafter']);
  assert.equal(manager.children.get('miner'),miner);assert.equal(manager.children.has('builder'),false);assert.equal(spawned.length,3);assert.equal(spawned[2].options.autostart,true);
  manager.command('start');assert.deepEqual(miner.lastCommand,{type:'control',command:'start'});
  await assert.rejects(manager.apply(['unknown']));assert.equal(manager.children.size,2);
  await manager.apply([]);assert.equal(manager.children.size,0);assert.deepEqual(saved.at(-1),[]);await manager.close();
});
test('local team socket validates lifecycle requests and refuses a second launcher',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'colony-team-')),socketPath=join(dir,'t.sock');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const server=await serveTeamControl(request=>({available:true,action:request.action}),{socketPath});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal((await teamRequest({action:'status'},{socketPath})).available,true);
  assert.throws(()=>validateTeamRequest({action:'roles',roles:['miner','miner']}));
  await assert.rejects(serveTeamControl(()=>({}),{socketPath}),/already running/);
});
test('dashboard roster endpoint needs operator authentication and delegates only lifecycle requests',async t=>{
  const requests=[],f=await fixture(t,{teamControl:request=>{validateTeamRequest(request);requests.push(request);return {available:true,roles:[]};}});
  assert.equal((await fetch(f.urls.httpUrl+'/api/roster')).status,401);
  const result=await f.control('/api/roster',{action:'roles',roles:['miner','crafter']});assert.equal(result.available,true);
  const invalid=await fetch(f.urls.httpUrl+'/api/roster',{method:'POST',headers:{Authorization:'Bearer test-operator','Content-Type':'application/json'},body:JSON.stringify({action:'roles',roles:['bad-role']})});
  assert.equal(invalid.status,400);
  assert.deepEqual(requests,[{action:'roles',roles:['miner','crafter']}]);assert.equal(f.relay.snapshot().agents.length,0);
});
