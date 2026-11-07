import test from 'node:test';
import assert from 'node:assert/strict';
import { MinecraftChannel } from '../../src/comms/minecraft-channel.js';
import { fixture, eventually } from './helpers.js';

const miner='Flint_Miner',builder='Ember_Builder';
function make(f,agentId,options={}) {
  const state=options.state || {history:[],seen:[],knowledge:[]},learned=[],saved=[];
  const channel=new MinecraftChannel({agentId,state,url:f.urls.wsUrl,
    save:()=>saved.push(structuredClone(state)),learn:e=>learned.push(e),
    observe:()=>({status:{minecraft:{connected:true},task:'working',details:{simulated:true}},resources:{oak_log:4}}),
    ...options});
  f.clients.push(channel);return {channel,state,learned,saved};
}

test('Minecraft discoveries use the relay; isolation blocks knowledge while reported game presence stays connected',async t=>{
  const f=await fixture(t),a=make(f,miner),b=make(f,builder);
  await eventually(()=>a.channel.client.ready && b.channel.client.ready);
  await f.control('/api/isolation',{agentId:builder,isolated:true});
  a.channel.publish('Wood',{x:8,y:65,z:3});a.channel.tick();
  await eventually(()=>f.relay.snapshot().agents.find(a=>a.id===builder).pendingMessages>0);
  assert.equal(b.state.knowledge.length,0);
  assert.equal(b.channel.receive(miner,'[TEAM 0123abcd] Wood at 8 65 3'),false);
  const report=f.relay.snapshot().agents.find(a=>a.id===builder);
  assert.equal(report.connection.state,'connected');assert.equal(report.minecraft.value,'connected');
  await f.control('/api/heal',{});
  await eventually(()=>b.learned.length===1);
  assert.deepEqual(b.learned[0].position,[8,65,3]);
  a.channel.tick();await eventually(()=>a.channel.client.outbox.size===0);
  assert.equal(b.learned.length,1);
  const key=JSON.stringify([miner,'RESOURCE_UPDATE']);
  assert.ok(b.saved.some(s=>s.peerReports?.[key]?.stateVersion && s.knowledge.length===1));
});

test('local comms off closes only the relay adapter and preserves discoveries for rejoining',async t=>{
  const f=await fixture(t),a=make(f,miner),b=make(f,builder);
  await eventually(()=>a.channel.client.ready && b.channel.client.ready);
  a.channel.setOnline(false);
  await eventually(()=>f.relay.snapshot().agents.find(a=>a.id===miner).connection.state==='disconnected');
  a.channel.publish('Stone',{x:1,y:64,z:2});a.channel.tick();
  assert.equal(a.state.history.length,1);assert.equal(b.state.knowledge.length,0);
  assert.equal(f.relay.snapshot().agents.find(a=>a.id===miner).minecraft.value,'connected');
  a.channel.setOnline(true);
  await eventually(()=>b.learned.length===1);
  assert.equal(b.learned[0].kind,'Stone');
});

test('agent restarts persist a new epoch and restore received state watermarks with local knowledge',async t=>{
  const f=await fixture(t),a=make(f,miner),b=make(f,builder);
  await eventually(()=>a.channel.client.ready && b.channel.client.ready);
  a.channel.publish('Sand',{x:3,y:64,z:4});a.channel.tick();
  await eventually(()=>b.learned.length===1);
  b.channel.close();await eventually(()=>f.relay.snapshot().agents.find(a=>a.id===builder).connection.state==='disconnected');
  const saved=structuredClone(b.state),restart=make(f,builder,{state:saved});
  assert.equal(restart.state.commsEpoch,b.state.commsEpoch+1);
  const key=JSON.stringify([miner,'RESOURCE_UPDATE']);
  assert.deepEqual(restart.channel.client.peerState.get(key).stateVersion,b.state.peerReports[key].stateVersion);
  await eventually(()=>restart.channel.client.ready);
  a.channel.tick();await eventually(()=>a.channel.client.outbox.size===0);
  assert.equal(restart.state.knowledge.length,1);
});

test('malformed discoveries and unknown senders never become role knowledge',async t=>{
  const f=await fixture(t),b=make(f,builder);
  const message={id:'snapshot',type:'RESOURCE_UPDATE',from:miner,to:'*',sentAt:Date.now(),ttlMs:1000,
    stateVersion:{epoch:1,revision:1},payload:{resources:{},discoveries:[
      {id:'0123abcd',kind:'Wood',position:[1,2,3],time:Date.now()+60_000},
      {id:'0123abce',kind:'Diamond',position:[1,2,3],time:Date.now()},
      {id:'0123abcf',kind:'Stone',position:[Infinity,2,3],time:Date.now()},
    ]}};
  b.channel.accept(message);assert.equal(b.state.knowledge.length,0);
  b.channel.accept({...message,from:'NotOurTeam',payload:{resources:{},discoveries:[
    {id:'0123abcd',kind:'Wood',position:[1,2,3],time:Date.now()}]}});
  assert.equal(b.state.knowledge.length,0);
  assert.equal(Object.keys(b.state.peerReports).length,1);
});
