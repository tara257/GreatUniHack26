import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient } from '../../src/comms/agent-client.js';
import { createRelay } from '../../src/comms/relay.js';
import { fixture, eventually } from './helpers.js';

test('client deduplicates redelivery while an asynchronous handler is still working',async t=>{
  const f=await fixture(t),sender=await f.agent('sender');
  let calls=0;
  const receiver=new AgentClient({agentId:'receiver',url:f.urls.wsUrl,heartbeatMs:0,
    onMessage:async()=>{calls++;await new Promise(r=>setTimeout(r,130));}});
  f.clients.push(receiver);receiver.start();await eventually(()=>receiver.ready);
  const m=sender.publish('TASK_COMPLETE',{taskId:'roof'},{to:'receiver'});
  await sender.wait('DELIVERY_STATUS',r=>r.id===m.id && r.status==='delivered');
  assert.equal(calls,1);
});

test('a failed handler is not acknowledged and can recover on retry',async t=>{
  const f=await fixture(t),sender=await f.agent('sender');let calls=0,errors=0;
  const receiver=new AgentClient({agentId:'receiver',url:f.urls.wsUrl,heartbeatMs:0,
    onMessage:async()=>{if(++calls===1)throw new Error('Temporary local error');}});
  receiver.on('handlerError',()=>errors++);
  f.clients.push(receiver);receiver.start();await eventually(()=>receiver.ready);
  const m=sender.publish('RESOURCE_UPDATE',{resources:{oak_log:4}},{to:'receiver'});
  await sender.wait('DELIVERY_STATUS',r=>r.id===m.id && r.status==='delivered');
  assert.equal(calls,2);assert.equal(errors,1);
});

test('independent work continues through relay loss; clients reconnect and exchange queued messages',async t=>{
  const f=await fixture(t);let workSteps=0;const work=setInterval(()=>workSteps++,5);t.after(()=>clearInterval(work));
  const received=[],epochs=[];
  const settings={url:f.urls.wsUrl,heartbeatMs:0,reconnectMinMs:20,reconnectMaxMs:60,retryMs:40};
  const a=new AgentClient({...settings,agentId:'A'}),b=new AgentClient({...settings,agentId:'B',onMessage:async m=>received.push(m)});
  f.clients.push(a,b);a.on('ready',e=>epochs.push(e));a.start();b.start();await eventually(()=>a.ready && b.ready);
  await f.relay.close();await eventually(()=>!a.ready && !b.ready);
  const before=workSteps,id=a.publish('TASK_COMPLETE',{taskId:'built-offline'},{to:'B',ttlMs:3000});
  await eventually(()=>workSteps>=before+10,'local work while relay unavailable');
  assert.equal(received.length,0);assert.ok(a.outbox.has(id));
  const port=Number(new URL(f.urls.httpUrl).port),replacement=createRelay({port,operatorToken:'test-operator',sweepMs:10});
  t.after(()=>replacement.close());await replacement.listen();
  await eventually(()=>received.some(m=>m.id===id),'delivery after server restart');
  assert.ok(epochs.some(e=>e.serverChanged));
  assert.ok(workSteps>before);
});

test('a direct publish retries until its intended peer registers',async t=>{
  const f=await fixture(t);const a=new AgentClient({agentId:'A',url:f.urls.wsUrl,heartbeatMs:0,retryMs:30});
  f.clients.push(a);a.start();await eventually(()=>a.ready);
  const errors=[];a.on('relayError',e=>errors.push(e));
  const id=a.publish('TASK_REQUEST',{requestId:'work'},{to:'later',ttlMs:1000});
  await eventually(()=>errors.some(e=>e.code==='UNKNOWN_RECIPIENT'));
  assert.ok(a.outbox.has(id));
  const later=await f.agent('later');await later.wait('MESSAGE',m=>m.message.id===id);
  await eventually(()=>!a.outbox.has(id));
});

test('local outbox pressure and expiry are observable and do not stop local work',async()=>{
  const a=new AgentClient({agentId:'offline',maxOutbox:1}),rejections=[];
  a.on('publishRejected',e=>rejections.push(e));
  const first=a.publish('HEARTBEAT',{}, {to:'@relay',ttlMs:50});
  const second=a.publish('HEARTBEAT',{}, {to:'@relay',ttlMs:50});
  assert.ok(rejections.some(e=>e.id===second && e.code==='OUTBOX_FULL'));
  await eventually(()=>{a.pump();return rejections.some(e=>e.id===first && e.code==='OUTBOX_EXPIRED');});
  assert.equal(rejections.find(e=>e.id===first).mayHaveBeenAccepted,false);a.close();
});
