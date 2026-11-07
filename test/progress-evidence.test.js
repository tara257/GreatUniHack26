import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressEvidence, emptyProgress } from '../src/progress-evidence.js';
import { OutageEvidence } from '../src/comms/outage-evidence.js';
import { dig, craft } from '../src/skills.js';
import { Vec3 } from '../src/world.js';

test('operation evidence excludes pre-outage work, failed/no-op outcomes and operations crossing windows',()=>{
  const p=new ProgressEvidence(),before=p.begin();
  p.setWindow('one');p.record(before,'resourceBlocks',10);
  const one=p.begin();p.record(one,'itemsCrafted',0);p.record(one,'wait',1);p.record(one,'itemsDeposited',-1);
  assert.deepEqual(p.snapshot().totals,emptyProgress());
  p.record(one,'resourceBlocks',2,'stone');p.setWindow('one');
  assert.equal(p.snapshot().totals.resourceBlocks,2);
  p.setWindow('two');p.record(one,'resourceBlocks',10);
  assert.equal(p.snapshot().totals.resourceBlocks,0);
  p.setWindow(null);p.record('two','resourceBlocks',10);
  assert.equal(p.snapshot().totals.resourceBlocks,0);
});

const links=[{a:'A',b:'B',policyAllowed:false},{a:'A',b:'C',policyAllowed:false},{a:'B',b:'C',policyAllowed:true}];
const status=(windowId,totals={},epoch=1,extra={})=>({stateVersion:{epoch,revision:1},payload:{minecraft:{connected:true},progress:{windowId,totals:{...emptyProgress(),...totals}},...extra}});

test('outage evidence requires its window marker and freezes at restoration, independent of sender clocks',()=>{
  const e=new OutageEvidence();e.topology(links,'isolation-enabled',100);
  const id=e.active.id;
  e.observe('A',status(null,{resourceBlocks:100}),101);e.observe('A',status('old',{resourceBlocks:100}),102);
  assert.equal(e.active.agents[0].samples,0);
  e.observe('A',status(id,{resourceBlocks:3}),103);
  e.observe('B',status(id,{itemsDeposited:5}),104);
  assert.equal(e.active.agents[0].totals.resourceBlocks,3);
  assert.equal(e.active.agents[0].blockedPeers,2);assert.equal(e.active.agents[1].blockedPeers,1);
  e.topology(links.map(l=>({...l,policyAllowed:true})),'network-restored',110);
  e.observe('A',status(id,{resourceBlocks:99}),111);
  assert.equal(e.history[0].agents[0].totals.resourceBlocks,3);assert.equal(e.history[0].endedAt,110);
});

test('repeated samples and agent restarts cannot double count or rewind evidence',()=>{
  const e=new OutageEvidence();e.topology(links,'test');const id=e.active.id;
  e.observe('A',status(id,{resourceBlocks:5}));e.observe('A',status(id,{resourceBlocks:5}));
  e.observe('A',status(id,{resourceBlocks:2}));assert.equal(e.active.agents[0].totals.resourceBlocks,5);
  e.disconnected('A');e.observe('A',status(id,{resourceBlocks:1},2));
  e.observe('A',status(id,{resourceBlocks:100},1));
  assert.equal(e.active.agents[0].totals.resourceBlocks,6);assert.ok(e.active.agents[0].interruptions>0);
  e.observe('A',status(id,{resourceBlocks:-1},2));assert.equal(e.active.agents[0].totals.resourceBlocks,6);
});

test('house comparison starts inside the window, excludes unknown cells and flags changed sites',()=>{
  const e=new OutageEvidence();e.topology(links,'test');const id=e.active.id;
  const house={blueprint:'starter',origin:{x:0,y:64,z:0},unknown:0,placed:10,required:83};
  e.observe('C',status(id,{},1,{house:{...house,unknown:1}}));assert.equal(e.active.house,null);
  e.observe('C',status(id,{},1,{house}));e.observe('C',status(id,{},1,{house:{...house,placed:13}}));
  assert.equal(e.active.house.before,10);assert.equal(e.active.house.after,13);
  e.observe('C',status(id,{},1,{house:{...house,origin:{x:100,y:64,z:0},placed:80}}));
  assert.equal(e.active.house.siteChanged,true);assert.equal(e.active.house.after,13);
});

test('topology changes create separate bounded windows; resetting clears evidence',()=>{
  const e=new OutageEvidence();e.topology(links,'test');const first=e.active;
  e.topology(links,'same');assert.equal(e.active.id,first.id);
  for(let n=0;n<12;n++)e.topology([{a:'A',b:'B'+n,policyAllowed:false}],'test');
  assert.ok(first.endedAt);assert.equal(e.history.length,8);
  e.reset([]);assert.deepEqual(e.snapshot(),{activeId:null,captures:[]});
});

test('mining records observed resource removal, excluding grass and failed digs',async()=>{
  const evidence=new ProgressEvidence();evidence.setWindow('dig');
  let block={name:'stone',position:new Vec3(0,64,0)};
  const bot={blockAt:()=>block,pathfinder:{bestHarvestTool:()=>null},canDigBlock:()=>true,dig:async()=>{block={name:'air'};}};
  const ctx={bot,evidence,alive:()=>true};
  await dig(ctx,new Vec3(0,64,0),{collect:false});assert.equal(evidence.totals.resourceBlocks,1);
  block={name:'short_grass'};await dig(ctx,new Vec3(0,64,0),{collect:false});assert.equal(evidence.totals.resourceBlocks,1);
  block={name:'stone'};bot.dig=async()=>{throw new Error('failed')};
  await assert.rejects(dig(ctx,new Vec3(0,64,0),{collect:false}));assert.equal(evidence.totals.resourceBlocks,1);
});

test('crafting records observed result items, not a successful promise without output',async()=>{
  const evidence=new ProgressEvidence();evidence.setWindow('craft');let count=0;
  const bot={registry:{itemsByName:{oak_planks:{id:1}}},inventory:{items:()=>[{name:'oak_planks',count}]},recipesAll:()=>[{}],recipesFor:()=>[{result:{count:4}}],craft:async()=>{count+=4;}};
  await craft({bot,evidence,alive:()=>true},'oak_planks',4);assert.equal(evidence.totals.itemsCrafted,4);
  bot.craft=async()=>{};await assert.rejects(craft({bot,evidence,alive:()=>true},'oak_planks',4),/no confirmed inventory gain/);assert.equal(evidence.totals.itemsCrafted,4);
});
