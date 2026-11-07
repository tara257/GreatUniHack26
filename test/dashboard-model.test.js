import test from 'node:test';
import assert from 'node:assert/strict';
import { inventories, communication, houseReport, stale } from '../dashboard/src/model.js';
import { observeHouse } from '../src/house-telemetry.js';
import { HOUSE } from '../src/blueprint.js';
import { Vec3,buildOrigin } from '../src/world.js';

test('resource totals exclude stale and disconnected observations and never invent missing inventory',()=>{
  const now=20000,agent=(id,receivedAt,connected=true)=>({id,minecraft:{value:connected?'connected':'disconnected',receivedAt},reports:{RESOURCE_UPDATE:{receivedAt,payload:{resources:{oak_log:4}}}}});
  const result=inventories([agent('fresh',19000),agent('stale',1),agent('offline',19000,false),{id:'missing',reports:{}}],now);
  assert.deepEqual(result.totals,{oak_log:4});assert.deepEqual(result.sources,['fresh']);assert.equal(result.staleCount,3);
  assert.equal(houseReport([]),null);assert.equal(stale(null,now),true);
});

test('communication labels distinguish missing agents, offline sockets, isolation and partitions',()=>{
  assert.equal(communication(null).label,'Not registered');
  const a={connection:{state:'disconnected'},communication:{isolated:true,partition:null,blockedPeers:[]}};
  assert.equal(communication(a).label,'Relay offline');a.connection.state='connected';assert.equal(communication(a).label,'Isolated');
  a.communication.isolated=false;a.communication.partition='1';assert.equal(communication(a).label,'Partition B');
});

test('house progress is measured from loaded world blocks and identifies incomplete observation',()=>{
  const bot={spawnPoint:new Vec3(0,64,0),entity:{},blockAt:()=>({name:'air'})};
  const origin=buildOrigin(bot),cell=HOUSE.cells.find(c=>c.material==='cobblestone');
  bot.blockAt=p=>p.x===origin.x+cell.x && p.y===origin.y+cell.y && p.z===origin.z+cell.z?{name:'cobblestone'}:{name:'air'};
  const result=observeHouse(bot);
  assert.equal(result.placed,1);assert.equal(result.required,83);assert.equal(result.unknown,0);
  assert.equal(result.phases[0].placed,1);assert.equal(result.cells.filter(c=>c.status==='complete').length,1);
  bot.blockAt=()=>null;const unloaded=observeHouse(bot);assert.equal(unloaded.placed,0);assert.equal(unloaded.unknown,83);
  assert.equal(observeHouse(null),null);
});
