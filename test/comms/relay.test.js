import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { fixture, rawAgent, eventually } from './helpers.js';

test('all six message types relay without making gameplay decisions',async t=>{
  const f=await fixture(t),a=await f.agent('Ember'),b=await f.agent('Flint');
  const payloads={STATUS_UPDATE:{minecraft:{connected:true},health:18,hunger:15,task:'gathering',position:{x:1,y:64,z:2}},
    RESOURCE_REQUEST:{resource:'oak_log',amount:4},RESOURCE_UPDATE:{resources:{oak_log:8}},
    TASK_COMPLETE:{taskId:'floor-1'},TASK_REQUEST:{requestId:'work-1'},HEARTBEAT:{uptimeMs:100}};
  for(const [type,payload] of Object.entries(payloads)) {
    const m=a.publish(type,payload,{to:'Flint'});
    await a.wait('PUBLISH_ACK',r=>r.id===m.id);
    const delivered=await b.wait('MESSAGE',r=>r.message.id===m.id);
    assert.equal(delivered.message.from,'Ember');assert.deepEqual(delivered.message.payload,payload);
    await a.wait('DELIVERY_STATUS',r=>r.id===m.id && r.status==='delivered');
  }
  assert.equal(b.messages().length,6);
  const snapshot=f.relay.snapshot(),ember=snapshot.agents.find(a=>a.id==='Ember');
  assert.equal(ember.minecraft.value,'connected');assert.equal(ember.heartbeat.stale,false);
  assert.equal(ember.reports.TASK_COMPLETE.payload.taskId,'floor-1');
  assert.equal(snapshot.counters.delivered,6);
});

test('identity, schema, and idempotency are enforced',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B');
  const duplicate=await f.agent('ignored',{register:false});
  duplicate.send({v:1,kind:'REGISTER',agentId:'A'});
  assert.equal((await duplicate.wait('ERROR')).code,'ID_IN_USE');
  await eventually(()=>duplicate.closed);
  const forged=a.publish('HEARTBEAT',{}, {to:'B',from:'B'});
  assert.equal((await a.wait('ERROR',e=>e.id===forged.id)).code,'INVALID_MESSAGE');
  const invalid=a.publish('RESOURCE_REQUEST',{resource:'oak_log',amount:-1},{to:'B'});
  assert.equal((await a.wait('ERROR',e=>e.id===invalid.id)).code,'INVALID_MESSAGE');
  const m=a.publish('RESOURCE_UPDATE',{resources:{oak_log:2}},{to:'B'});
  await a.wait('DELIVERY_STATUS',r=>r.id===m.id && r.status==='delivered');
  a.send({v:1,kind:'PUBLISH',message:m});
  await a.wait('PUBLISH_ACK',r=>r.id===m.id && r.status==='duplicate');
  await b.barrier();assert.equal(b.messages(m.id).length,1);
  a.send({v:1,kind:'PUBLISH',message:{...m,payload:{resources:{oak_log:99}}}});
  assert.equal((await a.wait('ERROR',e=>e.id===m.id)).code,'ID_REUSE');
  assert.equal(f.relay.snapshot().agents.find(a=>a.id==='A').reports.RESOURCE_UPDATE.payload.resources.oak_log,2);
});

test('isolation blocks both directions while sockets, Minecraft reports, and heartbeats remain available',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B'),c=await f.agent('C');
  b.publish('STATUS_UPDATE',{minecraft:{connected:true},task:'building'},{to:'@relay'});await b.barrier();
  await f.control('/api/isolation',{agentId:'B',isolated:true});
  const ab=a.publish('RESOURCE_REQUEST',{resource:'oak_log',amount:3},{to:'B'});
  const ba=b.publish('RESOURCE_UPDATE',{resources:{oak_log:7}},{to:'A'});
  const ac=a.publish('TASK_COMPLETE',{taskId:'wall'},{to:'C'});
  await a.wait('PUBLISH_ACK',r=>r.id===ab.id);await b.wait('PUBLISH_ACK',r=>r.id===ba.id);
  await c.wait('MESSAGE',r=>r.message.id===ac.id);await a.barrier();await b.barrier();
  assert.equal(b.messages(ab.id).length,0);assert.equal(a.messages(ba.id).length,0);
  const isolated=f.relay.snapshot().agents.find(a=>a.id==='B');
  assert.equal(isolated.connection.state,'connected');assert.equal(isolated.minecraft.value,'connected');
  assert.equal(isolated.communication.isolated,true);assert.equal(isolated.heartbeat.stale,false);
  assert.equal(isolated.pendingMessages,1);
  await f.control('/api/isolation',{agentId:'B',isolated:false});
  await b.wait('MESSAGE',r=>r.message.id===ab.id);await a.wait('MESSAGE',r=>r.message.id===ba.id);
  await eventually(()=>f.relay.snapshot().agents.every(a=>a.pendingMessages===0));
});

test('partition groups preserve intra-group delivery and heal without removing independent isolation',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B'),c=await f.agent('C'),d=await f.agent('D');
  await f.control('/api/partitions',{groups:[['A','B'],['C','D']]});
  const local=a.publish('TASK_REQUEST',{requestId:'local'},{to:'B'});
  const other=c.publish('TASK_REQUEST',{requestId:'other'},{to:'D'});
  const cross=a.publish('TASK_COMPLETE',{taskId:'roof'},{to:'C'});
  await b.wait('MESSAGE',r=>r.message.id===local.id);await d.wait('MESSAGE',r=>r.message.id===other.id);
  await a.wait('PUBLISH_ACK',r=>r.id===cross.id);await c.barrier();assert.equal(c.messages(cross.id).length,0);
  await f.control('/api/isolation',{agentId:'C',isolated:true});
  await f.control('/api/partitions',{groups:[]});await c.barrier();assert.equal(c.messages(cross.id).length,0);
  await f.control('/api/isolation',{agentId:'C',isolated:false});await c.wait('MESSAGE',r=>r.message.id===cross.id);
  await f.control('/api/links',{a:'A',b:'B',enabled:false});
  const blocked=b.publish('HEARTBEAT',{}, {to:'A'});await b.wait('PUBLISH_ACK',r=>r.id===blocked.id);await a.barrier();
  assert.equal(a.messages(blocked.id).length,0);
  await f.control('/api/links',{a:'A',b:'B',enabled:true});await a.wait('MESSAGE',r=>r.message.id===blocked.id);
});

test('physical disconnection is distinct from Minecraft state and messages replay on reconnect',async t=>{
  const f=await fixture(t,{statusStaleMs:30}),a=await f.agent('A'),b=await f.agent('B');
  const status=b.publish('STATUS_UPDATE',{minecraft:{connected:true}},{to:'@relay'});await b.wait('PUBLISH_ACK',r=>r.id===status.id);
  b.close();await eventually(()=>f.relay.snapshot().agents.find(a=>a.id==='B').connection.state==='disconnected');
  const queued=a.publish('TASK_COMPLETE',{taskId:'floor'},{to:'B'});await a.wait('PUBLISH_ACK',r=>r.id===queued.id);
  await eventually(()=>f.relay.snapshot().agents.find(a=>a.id==='B').minecraft.stale);
  let state=f.relay.snapshot().agents.find(a=>a.id==='B');
  assert.equal(state.minecraft.value,'connected');assert.equal(state.communication.isolated,false);
  const back=await f.agent('B');await back.wait('MESSAGE',r=>r.message.id===queued.id);
  state=f.relay.snapshot().agents.find(a=>a.id==='B');assert.equal(state.connection.state,'connected');
  assert.equal(state.minecraft.stale,true); // Reopening the bus is not a new Minecraft observation.
});

test('broadcast recipient membership is fixed at acceptance; newcomers do not inherit shared knowledge',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B');
  const m=a.publish('RESOURCE_UPDATE',{resources:{oak_log:3}});await b.wait('MESSAGE',r=>r.message.id===m.id);
  const c=await f.agent('C');await c.barrier();assert.equal(c.messages(m.id).length,0);
  const query=c.publish('RESOURCE_REQUEST',{resource:'oak_log',amount:1});
  await a.wait('MESSAGE',r=>r.message.id===query.id);
  const response=a.publish('RESOURCE_UPDATE',{resources:{oak_log:3}},{to:'C',correlationId:query.id});
  await c.wait('MESSAGE',r=>r.message.id===response.id);
});

test('unacknowledged messages are retried and receipt ACKs remove pending work',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B',{autoAck:false});
  const m=a.publish('TASK_COMPLETE',{taskId:'door'},{to:'B'});
  await eventually(()=>b.messages(m.id).length>=2,'redelivery');
  b.send({v:1,kind:'ACK',from:'A',id:m.id});
  await a.wait('DELIVERY_STATUS',r=>r.id===m.id && r.status==='delivered');
  assert.equal(f.relay.snapshot().agents.find(a=>a.id==='B').pendingMessages,0);
});

test('expiry is explicit and restoring communication cannot revive stale requests',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B');
  await f.control('/api/isolation',{agentId:'B',isolated:true});
  const m=a.publish('RESOURCE_REQUEST',{resource:'oak_log',amount:2},{to:'B',ttlMs:80});
  await a.wait('DELIVERY_STATUS',r=>r.id===m.id && r.status==='expired');
  await f.control('/api/isolation',{agentId:'B',isolated:false});await b.barrier();
  assert.equal(b.messages(m.id).length,0);assert.equal(f.relay.snapshot().counters.expired,1);
});

test('broadcast admission is atomic when one destination queue is full',async t=>{
  const f=await fixture(t,{maxPendingPerAgent:1}),a=await f.agent('A'),b=await f.agent('B'),c=await f.agent('C');
  await f.control('/api/isolation',{agentId:'B',isolated:true});
  const first=a.publish('TASK_COMPLETE',{taskId:'first'},{to:'B'});await a.wait('PUBLISH_ACK',r=>r.id===first.id);
  const second=a.publish('TASK_COMPLETE',{taskId:'second'});
  assert.equal((await a.wait('ERROR',e=>e.id===second.id)).code,'QUEUE_FULL');
  await c.barrier();assert.equal(c.messages(second.id).length,0);
  assert.equal(f.relay.snapshot().agents.find(a=>a.id==='C').pendingMessages,0);
});

test('dashboard/control access is separate from agent connections; observers are read-only',async t=>{
  const f=await fixture(t,{agentToken:'agent-secret'});
  const response=await fetch(f.urls.httpUrl+'/api/state',{headers:{Authorization:'Bearer agent-secret'}});assert.equal(response.status,401);
  const a=await f.agent('A',{token:'agent-secret'});
  a.send({v:1,kind:'ISOLATE',agentId:'A'});assert.equal((await a.wait('ERROR')).code,'INVALID_FRAME');
  assert.equal(f.relay.snapshot().agents[0].communication.isolated,false);
  const observer=new WebSocket(f.urls.observerUrl),frames=[];
  f.clients.push({close:()=>observer.terminate()});observer.on('error',()=>{});
  observer.on('message',raw=>frames.push(JSON.parse(raw)));
  await eventually(()=>observer.readyState===WebSocket.OPEN);
  observer.send(JSON.stringify({v:1,kind:'SUBSCRIBE',token:'test-operator'}));
  await eventually(()=>frames.some(f=>f.kind==='SNAPSHOT'));
  await f.control('/api/isolation',{agentId:'A',isolated:true});
  await eventually(()=>frames.some(f=>f.state?.agents[0]?.communication.isolated));
  observer.send(JSON.stringify({v:1,kind:'PUBLISH',message:{}}));
  await eventually(()=>frames.some(f=>f.kind==='ERROR' && f.code==='READ_ONLY'));
});

test('transport ping timeout and application-heartbeat staleness are distinct',async t=>{
  const f=await fixture(t,{pingIntervalMs:20,pongTimeoutMs:80,heartbeatStaleMs:30});
  const alive=await f.agent('alive'),dead=await f.agent('dead',{autoPong:false});
  alive.publish('HEARTBEAT',{}, {to:'@relay'});await alive.barrier();
  await eventually(()=>dead.closed,'missing-pong termination');
  const state=f.relay.snapshot();
  assert.equal(state.agents.find(a=>a.id==='dead').connection.state,'disconnected');
  const connected=state.agents.find(a=>a.id==='alive');
  assert.equal(connected.connection.state,'connected');assert.equal(connected.heartbeat.stale,true);
});

test('malformed frames, oversize frames, and unregistered sockets do not compromise peers',async t=>{
  const f=await fixture(t,{registrationTimeoutMs:80}),a=await f.agent('A');
  a.ws.send('{broken');assert.equal((await a.wait('ERROR')).code,'INVALID_JSON');
  await a.barrier();
  const unregistered=await f.agent('unused',{register:false});await eventually(()=>unregistered.closed);
  const big=await f.agent('big');big.ws.send('x'.repeat(20_000));await eventually(()=>big.closed);
  assert.equal(big.closeCode,1009);assert.equal(f.relay.snapshot().agents.find(a=>a.id==='A').connection.state,'connected');
});
