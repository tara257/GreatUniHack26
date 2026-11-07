import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackNeed } from '../src/roles/adaptation.js';
import { survivalDecision } from '../src/survival.js';
import { dominantWood } from '../src/items.js';
import { confirmedClick } from '../src/inventory-sync.js';
import { EventEmitter } from 'node:events';
import { travel,Cancelled } from '../src/skills.js';
import { Vec3 } from '../src/world.js';

const v=over=>({siteNeed:{cobblestone:25},siteLoaded:true,inv:{},lowHealth:false,storageExists:true,storage:{contents:{},age:0},shortfall:{wood:0,cobblestone:25},...over});
test('scout takes over a persistent locally observed stone shortage without any peer or roster data',()=>{
  const memory={};assert.equal(fallbackNeed(memory,'scout',v(),{type:'scout_move'},0),null);
  assert.equal(fallbackNeed(memory,'scout',v(),{type:'scout_move'},15001),'stone');
  assert.equal(fallbackNeed(memory,'scout',v({shortfall:{wood:0,cobblestone:0}}),{type:'scout_move'},16000),null);
});
test('new supply progress restarts fallback patience; stale storage must be checked first',()=>{
  const m={};fallbackNeed(m,'builder',v(),{type:'wait'},0);
  assert.equal(fallbackNeed(m,'builder',v({shortfall:{wood:0,cobblestone:20}}),{type:'wait'},29999),null);
  assert.equal(fallbackNeed(m,'builder',v({shortfall:{wood:0,cobblestone:20}}),{type:'wait'},30001),null);
  assert.equal(fallbackNeed(m,'builder',v({storage:{contents:{},age:30000}}),{type:'wait'},70000),'inspect');
});
test('productive primary work is retained; absent crafter can be covered locally',()=>{
  const m={};const view=v({siteNeed:{oak_fence:13,oak_stairs:8},shortfall:{wood:0,cobblestone:0}});
  fallbackNeed(m,'builder',view,{type:'wait'},0);
  assert.equal(fallbackNeed(m,'builder',view,{type:'place'},40000),null);
  assert.equal(fallbackNeed(m,'builder',view,{type:'wait'},40000),'components');
});
test('starving agents seek food or eat instead of resting without regeneration',()=>{
  assert.equal(survivalDecision({health:2,hunger:5,food:'apple'}).type,'eat');
  assert.equal(survivalDecision({health:2,hunger:5,animal:{id:7,name:'cow'}}).type,'hunt');
  assert.equal(survivalDecision({health:2,hunger:5}).type,'explore');
  assert.equal(survivalDecision({health:2,hunger:20}).type,'rest');
  assert.equal(survivalDecision({health:20,hunger:20}),null);
});
test('compatible wood selection sums planks and logs of the same type',()=>{
  assert.equal(dominantWood({oak_planks:5,oak_log:1,birch_planks:6}),'oak');
});
// (The sand-for-glass trip tests were removed: the Nordic cottage uses fence windows, not glass.)
test('inventory clicks resolve on authoritative full-window sync even if crafting output stays unchanged',async()=>{
  const bot=new EventEmitter();bot.inventory={id:0,selectedItem:null};let sent;
  bot._client={write:(type,packet)=>{sent={type,packet};queueMicrotask(()=>bot.emit('setWindowItems:0'));}};
  await confirmedClick(bot,{toNotch:()=>({itemCount:0})},3,1,0,100);
  assert.equal(sent.packet.stateId,-1);assert.equal(sent.packet.slot,3);assert.equal(bot.listenerCount('setWindowItems:0'),0);
  bot._client.write=()=>{};
  await assert.rejects(confirmedClick(bot,{toNotch:()=>({})},3,1,0,10),/did not confirm/);
  assert.equal(bot.listenerCount('setWindowItems:0'),0);
});

test('distant routes use bounded waypoints, try a detour and still reach the destination',async()=>{
  const position=new Vec3(0,64,0),goals=[];let rejected=false;
  const ctx={alive:()=>true,bot:{entity:{position},pathfinder:{goto:async goal=>{
    goals.push(goal);
    if(!rejected){rejected=true;throw new Error('No path');}
    assert.ok(Math.hypot(goal.x-position.x,goal.z-position.z)<=23,'search stays local');
    position.x=goal.x;position.z=goal.z;if(goal.y!==undefined)position.y=goal.y;
  }}}};
  await travel(ctx,new Vec3(70,72,30));assert.ok(goals.length>4);assert.deepEqual(position,new Vec3(70,72,30));
  ctx.alive=()=>false;await assert.rejects(travel(ctx,new Vec3(150,72,30)),Cancelled);
});
