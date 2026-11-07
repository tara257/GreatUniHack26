import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { emptyProgress } from '../../src/progress-evidence.js';

test('five-agent outage proof remains available after healing, with no Minecraft control or stale replay credit',async t=>{
  const f=await fixture(t),agents=[];
  for(const id of ['Miner','Wood','Builder','Crafter','Scout'])agents.push(await f.agent(id));
  const outage=await f.control('/api/isolation',{agentId:'Miner',isolated:true}),id=outage.evidence.activeId;
  assert.ok(id);assert.equal(outage.evidence.captures.at(-1).blockedLinks.length,4);
  await agents[0].wait('LINK_STATE',r=>r.evidenceWindow===id);
  const publish=async (a,revision,windowId,resourceBlocks)=>{
    const m=a.publish('STATUS_UPDATE',{minecraft:{connected:true},progress:{windowId,totals:{...emptyProgress(),resourceBlocks}}},{to:'@relay',stateVersion:{epoch:1,revision}});
    await a.wait('PUBLISH_ACK',r=>r.id===m.id);
  };
  await publish(agents[0],1,null,200);
  await publish(agents[0],2,id,3);
  for(const a of agents.slice(1))await publish(a,1,id,0);
  const measured=f.relay.snapshot();assert.ok(measured.agents.every(a=>a.minecraft.value==='connected'));
  assert.equal(measured.evidence.captures.at(-1).agents.find(a=>a.id==='Miner').totals.resourceBlocks,3);
  const healed=await f.control('/api/heal',{});assert.equal(healed.evidence.activeId,null);
  assert.ok(healed.links.every(l=>l.canCommunicate));
  await publish(agents[0],3,id,100);
  assert.equal(f.relay.snapshot().evidence.captures.at(-1).agents.find(a=>a.id==='Miner').totals.resourceBlocks,3);
  const reset=await f.control('/api/reset',{});assert.deepEqual(reset.evidence.captures,[]);
});
