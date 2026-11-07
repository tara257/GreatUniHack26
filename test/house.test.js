import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprint, keyOf, parseHome, progress, selectTask, priority, SAFE_FOOD } from '../src/house.js';
import { TeamChannel } from '../src/channel.js';
import { Builder } from '../src/builder.js';
import { Vec3 } from 'vec3';

test('house encloses a walkable room with one two-block doorway and a supported roof', () => {
  const plan = blueprint([10,64,-10]);
  const cells = new Map(plan.map(t => [keyOf(t.position),t]));
  assert.equal(cells.size,plan.length);
  assert.equal(plan.filter(t => t.kind === 'planks').length,80);
  for (let z=0;z<5;z++) for (let x=0;x<5;x++) {
    assert.equal(cells.get(keyOf([10+x,64,-10+z])).kind,'planks');
    assert.equal(cells.get(keyOf([10+x,67,-10+z])).kind,'planks');
    if (x===0 || x===4 || z===0 || z===4) for (let y=1;y<=2;y++) {
      if (x===2 && z===0) continue;
      assert.equal(cells.get(keyOf([10+x,64+y,-10+z])).kind,'planks');
    }
  }
  assert.equal(cells.get('12,65,-10').kind,'door');
  assert.equal(cells.has('12,66,-10'),false);
  assert.equal(cells.get('12,65,-8').kind,'torch');
  assert.equal(cells.has('12,66,-8'),false);
  const supported = new Set(plan.filter(t=>t.phase<4).map(t=>keyOf(t.position)));
  for (const task of plan.filter(t=>t.phase===4)) {
    const [x,y,z]=task.position;
    assert.ok([[x,y-1,z],[x-1,y,z],[x+1,y,z],[x,y,z-1],[x,y,z+1]].some(p=>supported.has(keyOf(p))));
    supported.add(keyOf(task.position));
  }
});

test('independent builders choose separate work, then take over a missing teammate after a stall', () => {
  const plan = blueprint([0,64,0]);
  const first = [0,1,2].map(index=>selectTask({missing:plan,phase:0,index,stalledMs:0}));
  assert.equal(new Set(first.map(t=>keyOf(t.position))).size,3);
  const abandoned = plan.filter(t=>t.phase===0 && t.owner===2);
  assert.equal(selectTask({missing:abandoned,phase:0,index:0,stalledMs:19_999}),null);
  assert.equal(selectTask({missing:abandoned,phase:0,index:0,stalledMs:20_000}),abandoned[0]);
  assert.equal(selectTask({missing:abandoned,phase:0,index:0,stalledMs:20_000,claimed:()=>true}),null);
});

test('a destroyed block reopens the earlier construction phase for repair', () => {
  const plan=blueprint([0,64,0]);
  const world=new Map(plan.map(t=>[keyOf(t.position),{name:t.kind==='planks'?'oak_planks':t.kind==='door'?'oak_door':t.kind,getProperties:()=>({half:'lower'})}]));
  assert.equal(progress(plan,p=>world.get(keyOf(p))).missing.length,0);
  world.delete('0,65,0');
  const damage=progress(plan,p=>world.get(keyOf(p)));
  assert.equal(damage.phase,2);
  assert.equal(damage.missing.length,1);
});

test('survival interrupts building and avoids unsafe raw food', () => {
  const normal={food:20,health:20,hasFood:false,threat:false,foodCount:0,complete:false};
  assert.equal(priority(normal),'build');
  assert.equal(priority({...normal,food:10}),'forage');
  assert.equal(priority({...normal,food:14,hasFood:true}),'eat');
  assert.equal(priority({...normal,food:17,health:12}),'forage');
  assert.equal(priority({...normal,food:10,hasFood:true,threat:true}),'escape');
  assert.equal(priority({...normal,food:20,health:4}),'recover');
  assert.equal(priority({...normal,complete:true,foodCount:4}),'maintain');
  assert.equal(SAFE_FOOD.has('chicken'),false);
  assert.equal(SAFE_FOOD.has('rotten_flesh'),false);
});

test('a visible hostile interrupts active construction, but a wall provides shelter', async () => {
  let blocked=false,stops=0;
  const bot={entity:{position:new Vec3(0,64,0)},health:20,
    entities:{1:{name:'zombie',position:new Vec3(3,64,0)}},
    world:{raycast:()=>blocked?{}:null},pathfinder:{setGoal:()=>stops++},
    stopDigging(){},deactivateItem(){},clearControlStates(){}};
  const builder=new Builder({bot,state:{running:true},index:0,log(){},say(){}});
  builder.active={kind:'build',cancelled:false};
  await builder.tick();
  assert.equal(builder.active.cancelled,true);
  assert.equal(stops,1);
  blocked=true;
  builder.active={kind:'build',cancelled:false};
  await builder.tick();
  assert.equal(builder.active.cancelled,false);
  assert.equal(stops,1);
});

test('claims expire through outages and restarts, while completed work is replayed', () => {
  const state={history:[],seen:[],knowledge:[]},sent=[];
  const make=()=>new TeamChannel({state,send:s=>sent.push(s),save(){},learn(){}});
  const a=make();
  a.setOnline(false);
  const claim=a.publish('Claim',{x:1,y:64,z:2});
  claim.time=Date.now()-31_000;
  a.publish('Built',{x:2,y:64,z:2});
  const b=make(); b.setOnline(true); b.tick(); b.tick();
  assert.ok(sent.some(s=>s.includes('Built')));
  assert.ok(sent.every(s=>!s.includes('Claim')));
  assert.equal(b.receive('Flint',`[TEAM 0123abcd] Claim at 1 64 2 @${Date.now()-31_000}`),false);
  b.setOnline(false);
  assert.equal(b.receive('Moss',`[TEAM 4567abcd] Built at 1 64 2 @${Date.now()}`),false);
});

test('mission coordinates reject ambiguous or out-of-world positions', () => {
  assert.deepEqual(parseHome('190,72,118'),[190,72,118]);
  for (const value of ['', '1 2','1.5 2 3','1 9999 3','Infinity 2 3','1 2 3 4']) assert.equal(parseHome(value),null);
});

test('unreachable dropped resources do not trap the agent in an endless pickup retry', async () => {
  const bot={entity:{position:new Vec3(0,64,0)},health:20,
    inventory:{items:()=>[]},entities:{7:{id:7,name:'item',position:new Vec3(1,64,0),getDroppedItem:()=>({name:'oak_log'})}}};
  const builder=new Builder({bot,state:{running:true},index:0,log(){},say(){}});
  builder.active={cancelled:false};
  let attempts=0;
  builder.go=async()=>{attempts++;throw new Error('No path');};
  assert.equal(await builder.collectDrops(n=>n==='oak_log'),false);
  assert.equal(await builder.collectDrops(n=>n==='oak_log'),false);
  assert.equal(attempts,1);
});
