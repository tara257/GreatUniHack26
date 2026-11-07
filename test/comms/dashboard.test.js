import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

test('local dashboard authentication requires the exact trusted origin and explicit header',async t=>{
  const f=await fixture(t),path=f.urls.httpUrl+'/dashboard/session';
  for(const headers of [{},{origin:'https://outside.example','x-colony-dashboard':'1'},{origin:f.urls.httpUrl}]) {
    assert.equal((await fetch(path,{method:'POST',headers})).status,403);
  }
  const accepted=await fetch(path,{method:'POST',headers:{origin:f.urls.httpUrl,'x-colony-dashboard':'1'}});
  assert.equal(accepted.status,200);assert.equal((await accepted.json()).token,'test-operator');
  const api=await fetch(f.urls.httpUrl+'/api/state');assert.equal(api.status,401);
});

test('reset restores network and restarts metrics without closing agents, losing queued work or rewinding reports',async t=>{
  const f=await fixture(t),a=await f.agent('A'),b=await f.agent('B');
  const status=a.publish('STATUS_UPDATE',{minecraft:{connected:true},house:{placed:12,required:83}},{to:'@relay'});
  await a.wait('PUBLISH_ACK',r=>r.id===status.id);
  await f.control('/api/isolation',{agentId:'B',isolated:true});
  const queued=a.publish('TASK_REQUEST',{requestId:'survive-reset'},{to:'B'});
  await a.wait('PUBLISH_ACK',r=>r.id===queued.id);
  const previous=f.relay.snapshot();
  const unauthorized=await fetch(f.urls.httpUrl+'/api/reset',{method:'POST',body:'{}'});assert.equal(unauthorized.status,401);
  const reset=await f.control('/api/reset',{});
  assert.notEqual(reset.runId,previous.runId);assert.ok(reset.revision>previous.revision);
  assert.equal(reset.counters.accepted,0);assert.ok(reset.links.every(l=>l.canCommunicate));
  assert.ok(reset.agents.every(a=>a.connection.state==='connected'));
  assert.equal(reset.agents.find(a=>a.id==='A').reports.STATUS_UPDATE.payload.house.placed,12);
  assert.ok(reset.recentEvents.some(e=>e.kind==='simulation-reset'));
  assert.ok(!reset.recentEvents.some(e=>e.kind==='isolation-enabled'));
  await b.wait('MESSAGE',m=>m.message.id===queued.id);
  a.send({v:1,kind:'PUBLISH',message:queued});
  await a.wait('PUBLISH_ACK',r=>r.id===queued.id && r.status==='duplicate');
});

test('saved fault policy is applied before reconnecting agents exchange data',async t=>{
  let saved;
  const f=await fixture(t,{initialFaults:{isolatedIds:['B'],groups:[['A','B'],['C']],disabledPairs:[['A','B']]},onFaultChange:policy=>saved=policy});
  const a=await f.agent('A'),b=await f.agent('B');await f.agent('C');
  assert.ok(f.relay.snapshot().links.every(l=>!l.canCommunicate));
  const m=a.publish('TASK_REQUEST',{requestId:'held'},{to:'B'});await a.wait('PUBLISH_ACK',r=>r.id===m.id);
  await b.barrier();assert.equal(b.messages(m.id).length,0);
  await f.control('/api/reset',{});
  assert.deepEqual(saved,{isolatedIds:[],groups:[],disabledPairs:[]});
  await b.wait('MESSAGE',r=>r.message.id===m.id);
});
