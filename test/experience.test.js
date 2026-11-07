import test from 'node:test';
import assert from 'node:assert/strict';
import { Experience } from '../src/experience.js';
import { TeamChannel } from '../src/channel.js';
import { priority } from '../src/house.js';
import { Builder } from '../src/builder.js';
import { Vec3 } from 'vec3';

test('route failures change decisions, survive restart, and retry with increasing delays', () => {
  let now=1_000_000;
  const state={deaths:3},point=[12,64,20];
  let memory=new Experience(state,()=>{},()=>now);
  assert.equal(memory.blocked(point),false);
  memory.failed(point,'No path');
  assert.equal(memory.blocked(point),true);
  const saved=JSON.parse(JSON.stringify(state));
  memory=new Experience(saved,()=>{},()=>now);
  now+=15_001;
  assert.equal(memory.blocked(point),false);
  memory.failed(point,'No path');
  now+=15_001;
  assert.equal(memory.blocked(point),true);
  now+=15_000;
  assert.equal(memory.blocked(point),false);
  memory.succeeded(point);
  assert.equal(memory.failures(point),0);
  assert.equal(memory.blocked(point),false);
});

test('fresh local success overrides an older replayed teammate failure', () => {
  let now=100_000;
  const memory=new Experience({},()=>{},()=>now),point=[1,64,2];
  memory.succeeded(point);
  memory.observe({kind:'Blocked',position:point,time:now-1000});
  assert.equal(memory.blocked(point),false);
  now+=1000;
  memory.observe({kind:'Blocked',position:point,time:now});
  assert.equal(memory.blocked(point),true);
  now+=30_001;
  memory.observe({kind:'Blocked',position:point,time:now-30_001});
  assert.equal(memory.blocked(point),false);
});

test('death lessons affect nearby routes, decay, and cannot be inflated by replay', () => {
  let now=100_000;
  const memory=new Experience({},()=>{},()=>now);
  const event={id:'abc',sender:'Moss',kind:'Death',position:[10,64,10],time:now};
  memory.observe(event);
  const risk=memory.risk([10,64,10]);
  assert.ok(risk>memory.risk([15,64,10]));
  assert.equal(memory.risk([100,64,10]),0);
  memory.observe(event);
  assert.equal(memory.risk([10,64,10]),risk);
  now+=600_001;
  assert.equal(memory.risk([10,64,10]),0);
});

test('peer experience cannot cross a communication outage, then replays on reconnect', () => {
  const make=()=>{
    const state={history:[],knowledge:[],seen:[]},sent=[];
    const memory=new Experience(state);
    const channel=new TeamChannel({state,save(){},send:text=>sent.push(text),learn:e=>memory.observe(e)});
    return {memory,channel,sent};
  };
  const a=make(),b=make(),point={x:12,y:64,z:20};
  b.channel.setOnline(false);
  a.channel.publish('Death',point); a.channel.tick();
  b.channel.receive('Ember',a.sent.shift());
  assert.equal(b.memory.risk([12,64,20]),0);
  b.channel.setOnline(true);
  a.channel.receive('Flint',b.sent.shift()); a.channel.tick();
  assert.equal(b.channel.receive('Ember',a.sent.shift()),true);
  assert.ok(b.memory.risk([12,64,20])>0);
});

test('experience is bounded over a long run', () => {
  let now=0;
  const memory=new Experience({},()=>{},()=>++now);
  for(let i=0;i<300;i++) memory.failed([i,64,i],'No path');
  assert.equal(Object.keys(memory.data.routes).length,128);
  assert.equal(memory.data.episodes.length,128);
  assert.equal(memory.data.metrics.navigationFailures,300);
});

test('night safety and recovery take precedence over speculative food collection', () => {
  const ready={food:20,health:20,hasFood:false,threat:false,foodCount:0,complete:true,shelterReady:true,night:true};
  assert.equal(priority(ready),'shelter');
  assert.equal(priority({...ready,night:false}),'forage');
  assert.equal(priority({...ready,food:14,hasFood:true}),'eat');
  assert.equal(priority({...ready,threat:true}),'escape');
  assert.equal(priority({...ready,night:false,health:6,food:18}),'recover');
  assert.equal(priority({...ready,shelterReady:false,complete:false}),'build');
});

test('an operator cancellation does not teach a false route failure', async () => {
  const bot={entity:{position:new Vec3(10,64,10)},health:20,blockAt:()=>null,
    pathfinder:{goto:async()=>{builder.active.cancelled=true;throw new Error('Goal changed');}}};
  const builder=new Builder({bot,state:{home:[0,64,0],running:true},channel:{publish(){throw new Error('Must not publish failure');}},index:0,save(){},log(){},say(){}});
  builder.active={kind:'build',cancelled:false};
  await assert.rejects(builder.go({x:20,y:64,z:20}),/Goal changed/);
  assert.equal(builder.experience.data.metrics.navigationFailures,0);
});

test('nightfall interrupts an expedition so the bot can return to shelter', async () => {
  let stopped=0;
  const bot={entity:{position:new Vec3(10,64,10)},health:20,entities:{},time:{timeOfDay:13000},
    pathfinder:{setGoal:()=>stopped++},stopDigging(){},deactivateItem(){},clearControlStates(){}};
  const builder=new Builder({bot,state:{running:true},index:0,save(){},log(){},say(){}});
  builder.shelterReady=true; builder.active={kind:'forage',cancelled:false};
  await builder.tick();
  assert.equal(builder.active.cancelled,true);
  assert.equal(stopped,1);
});

test('navigation timeouts are remembered even though the watchdog cancels movement', async () => {
  const sent=[];
  const bot={entity:{position:new Vec3(10,64,10)},health:20,blockAt:()=>null,
    pathfinder:{goto:async()=>{builder.active.cancelled=true;builder.active.cancelReason='timeout';throw new Error('Goal changed');}}};
  const builder=new Builder({bot,state:{home:[0,64,0],running:true},channel:{publish:(...e)=>sent.push(e)},index:0,save(){},log(){},say(){}});
  builder.active={kind:'build',cancelled:false};
  await assert.rejects(builder.go({x:20,y:64,z:20}),/Goal changed/);
  assert.equal(builder.experience.data.metrics.navigationFailures,1);
  assert.equal(builder.experience.blocked([20,64,20]),true);
  assert.equal(sent[0][0],'Blocked');
});

test('door closing yields to another player in the opening', async () => {
  let closed=0;
  const bot={entity:{position:new Vec3(2,65,2)},entities:{1:{username:'Moss',position:new Vec3(2.5,65,0.5)}},
    blockAt:()=>({name:'oak_door',position:new Vec3(2,65,0),getProperties:()=>({open:true})}),
    activateBlock:async()=>closed++};
  const builder=new Builder({bot,state:{home:[0,64,0]},index:0,save(){}});
  await builder.closeDoor();
  assert.equal(closed,0);
  assert.equal(builder.inDoorway(new Vec3(2.5,65,0.5)),true);
  assert.equal(builder.inside(new Vec3(2.5,50,2.5)),false);
});

test('the navigation controller actually skips a route it just failed', async () => {
  let calls=0;
  const bot={entity:{position:new Vec3(10,64,10)},health:20,blockAt:()=>null,
    pathfinder:{goto:async()=>{calls++;throw new Error('No path');}}};
  const builder=new Builder({bot,state:{home:[0,64,0],running:true},channel:{publish(){}},index:0,save(){},log(){},say(){}});
  builder.active={kind:'build',cancelled:false};
  await assert.rejects(builder.go({x:20,y:64,z:20}),/No path/);
  await assert.rejects(builder.go({x:20,y:64,z:20}),error=>error.deferred===true);
  assert.equal(calls,1);
  assert.equal(builder.experience.data.metrics.deferredRoutes,1);
});
