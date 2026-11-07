import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient } from '../../src/comms/agent-client.js';
import { createRelay } from '../../src/comms/relay.js';
import { fixture, eventually, rawAgent } from './helpers.js';

const version=(revision,epoch=1)=>({epoch,revision});

test('relay rejects outdated and conflicting state without regressing operator reports',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B');
  const current=a.publish('STATUS_UPDATE',{minecraft:{connected:true},health:18},{stateVersion:version(3),sentAt:100});
  await a.wait('PUBLISH_ACK',m=>m.id===current.id);
  for(const options of [{stateVersion:version(2),sentAt:9999},{sentAt:9999},{stateVersion:version(999,0)}]) {
    const old=a.publish('STATUS_UPDATE',{minecraft:{connected:false},health:1},options);
    const error=await a.wait('ERROR',m=>m.id===old.id);
    assert.ok(['STALE_STATE','INVALID_MESSAGE'].includes(error.code));
    assert.equal(b.messages(old.id).length,0);
  }
  const conflict=a.publish('STATUS_UPDATE',{health:1},{stateVersion:version(3)});
  assert.equal((await a.wait('ERROR',m=>m.id===conflict.id)).code,'STATE_CONFLICT');
  assert.equal(f.relay.snapshot().agents.find(a=>a.id==='A').minecraft.value,'connected');
  // Source version wins even when its wall clock moves backwards.
  const next=a.publish('STATUS_UPDATE',{health:19},{stateVersion:version(4),sentAt:50});
  await a.wait('PUBLISH_ACK',m=>m.id===next.id);
  const report=f.relay.snapshot().agents.find(a=>a.id==='A').reports.STATUS_UPDATE;
  assert.equal(report.payload.health,19);assert.deepEqual(report.stateVersion,version(4));
  assert.ok(f.relay.snapshot().recentEvents.some(e=>e.kind==='state-rejected'));
});

test('version epochs distinguish a restarted source from delayed old-incarnation messages',async t=>{
  const f=await fixture(t),a=await f.agent('A');
  const first=a.publish('RESOURCE_UPDATE',{resources:{oak_log:8}},{to:'@relay',stateVersion:version(50)});
  await a.wait('PUBLISH_ACK',m=>m.id===first.id);
  a.close();await eventually(()=>f.relay.snapshot().agents[0].connection.state==='disconnected');
  const restarted=await f.agent('A');
  const next=restarted.publish('RESOURCE_UPDATE',{resources:{oak_log:2}},{to:'@relay',stateVersion:version(1,2)});
  await restarted.wait('PUBLISH_ACK',m=>m.id===next.id);
  const late=restarted.publish('RESOURCE_UPDATE',{resources:{oak_log:99}},{to:'@relay',stateVersion:version(51)});
  assert.equal((await restarted.wait('ERROR',m=>m.id===late.id)).code,'STALE_STATE');
  assert.equal(f.relay.snapshot().agents[0].reports.RESOURCE_UPDATE.payload.resources.oak_log,2);
});

test('asynchronous state handlers are serialized so a slow old update cannot finish after a new one',async t=>{
  const f=await fixture(t),a=await f.agent('A'),applied=[];
  const b=new AgentClient({agentId:'B',url:f.urls.wsUrl,heartbeatMs:0,onMessage:async m=>{
    if(m.stateVersion.revision===1)await new Promise(r=>setTimeout(r,120));
    applied.push(m.payload.resources.oak_log);
  }});
  f.clients.push(b);b.start();await eventually(()=>b.ready);
  a.publish('RESOURCE_UPDATE',{resources:{oak_log:1}},{to:'B',stateVersion:version(1)});
  const latest=a.publish('RESOURCE_UPDATE',{resources:{oak_log:2}},{to:'B',stateVersion:version(2)});
  await a.wait('DELIVERY_STATUS',m=>m.id===latest.id);
  assert.deepEqual(applied,[1,2]);
});

test('receiver watermarks survive relay restart and suppress stale or conflicting updates accepted by a fresh relay',async t=>{
  const f=await fixture(t),a=await f.agent('A'),applied=[],ignored=[];
  const b=new AgentClient({agentId:'B',url:f.urls.wsUrl,heartbeatMs:0,reconnectMinMs:20,reconnectMaxMs:40,
    onMessage:async m=>applied.push(m.payload.resources.oak_log)});
  f.clients.push(b);b.on('stateIgnored',e=>ignored.push(e.reason));b.start();await eventually(()=>b.ready);
  a.publish('RESOURCE_UPDATE',{resources:{oak_log:5}},{to:'B',stateVersion:version(5)});
  await eventually(()=>applied.length===1);
  await f.relay.close();await eventually(()=>!b.ready);
  const replacement=createRelay({port:Number(new URL(f.urls.httpUrl).port),operatorToken:'test-operator',sweepMs:10});
  t.after(()=>replacement.close());await replacement.listen();await eventually(()=>b.ready);
  const again=await rawAgent(f.urls.wsUrl,'A');f.clients.push(again);
  for(const [revision,count] of [[2,2],[5,99],[6,6]]) {
    const m=again.publish('RESOURCE_UPDATE',{resources:{oak_log:count}},{to:'B',stateVersion:version(revision)});
    await again.wait('DELIVERY_STATUS',r=>r.id===m.id);
  }
  assert.deepEqual(applied,[5,6]);assert.deepEqual(ignored,['stale','version-conflict']);
});

test('healing re-advertises latest own state after all old deliveries expire, without replaying expired requests',async t=>{
  const f=await fixture(t),received=[];
  const a=new AgentClient({agentId:'A',url:f.urls.wsUrl,heartbeatMs:0}),
    b=new AgentClient({agentId:'B',url:f.urls.wsUrl,heartbeatMs:0,onMessage:async m=>received.push(m)});
  f.clients.push(a,b);a.start();b.start();await eventually(()=>a.ready && b.ready);
  await f.control('/api/isolation',{agentId:'B',isolated:true});
  a.publish('RESOURCE_UPDATE',{resources:{oak_log:23}},{ttlMs:120});
  a.publish('RESOURCE_REQUEST',{resource:'stone',amount:1},{ttlMs:120});
  await eventually(()=>f.relay.snapshot().counters.expired>=2 && f.relay.snapshot().agents.every(a=>a.pendingMessages===0));
  assert.equal(received.length,0);
  const report=f.relay.snapshot().agents.find(a=>a.id==='A').reports.RESOURCE_UPDATE;
  await f.control('/api/heal',{});
  await eventually(()=>received.length>0);
  assert.deepEqual(received.map(m=>m.type),['RESOURCE_UPDATE']);
  assert.equal(received[0].payload.resources.oak_log,23);
  assert.equal(received[0].sentAt,report.reportedAt);
  assert.deepEqual(received[0].stateVersion,report.stateVersion);
  assert.equal(f.relay.snapshot().agents.find(a=>a.id==='A').reports.RESOURCE_UPDATE.receivedAt,report.receivedAt);
});

test('a newcomer learns current state from the source adapter without the relay sharing its global reports',async t=>{
  const f=await fixture(t),received=[];
  const a=new AgentClient({agentId:'A',url:f.urls.wsUrl,heartbeatMs:0});
  f.clients.push(a);a.start();await eventually(()=>a.ready);
  a.publish('RESOURCE_UPDATE',{resources:{oak_log:10}});
  a.publish('STATUS_UPDATE',{health:12},{to:'@relay'});
  await eventually(()=>a.outbox.size===0);
  const b=new AgentClient({agentId:'B',url:f.urls.wsUrl,heartbeatMs:0,onMessage:async m=>received.push(m)});
  f.clients.push(b);b.start();await eventually(()=>received.length>0);
  assert.deepEqual(received.map(m=>m.type),['RESOURCE_UPDATE']);
});

test('effective graph distinguishes physical loss from blocked links; heal is authenticated and logged',async t=>{
  const events=[],f=await fixture(t,{onEvent:e=>events.push(e)}),a=await f.agent('A'),b=await f.agent('B');
  const unauthorized=await fetch(f.urls.httpUrl+'/api/heal',{method:'POST',body:'{}'});
  assert.equal(unauthorized.status,401);
  await f.control('/api/links',{a:'A',b:'B',enabled:false});
  let link=f.relay.snapshot().links[0];
  assert.equal(link.transportAvailable,true);assert.equal(link.policyAllowed,false);assert.equal(link.canCommunicate,false);
  b.close();await eventually(()=>f.relay.snapshot().agents.find(a=>a.id==='B').connection.state==='disconnected');
  await f.control('/api/heal',{});link=f.relay.snapshot().links[0];
  assert.equal(link.policyAllowed,true);assert.equal(link.transportAvailable,false);assert.equal(link.canCommunicate,false);
  const back=await f.agent('B');await back.barrier();
  assert.equal(f.relay.snapshot().links[0].canCommunicate,true);
  assert.ok(events.some(e=>e.kind==='link-failed'));
  assert.ok(events.some(e=>e.kind==='network-restored'));
  assert.ok(events.every(e=>Number.isInteger(e.at) && e.serverId && e.revision));
});
