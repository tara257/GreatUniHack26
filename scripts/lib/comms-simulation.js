import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createRelay } from '../../src/comms/relay.js';

const ids=['Flint_Miner','Moss_Lumberjack','Ember_Builder','Sage_Crafter','Wren_Scout'];
const groups=[ids.slice(0,2),ids.slice(2,4),ids.slice(4)];
async function until(predicate,label) {
  const deadline=Date.now()+8000;
  while(Date.now()<deadline) {if(await predicate())return;await new Promise(r=>setTimeout(r,20));}
  throw new Error(`Simulation timed out: ${label}`);
}

export async function runFailureSimulation({log=()=>{}}={}) {
  const events=[],relay=createRelay({port:0,sweepMs:20,onEvent:e=>events.push(e)});
  const urls=await relay.listen(),children=[];
  const state=id=>relay.snapshot().agents.find(a=>a.id===id);
  async function control(path,body) {
    const response=await fetch(urls.httpUrl+path,{method:'POST',headers:{Authorization:`Bearer ${relay.operatorToken}`,
      'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,200);return response.json();
  }
  function inspect(child) {
    return new Promise((resolve,reject)=>{
      const requestId=randomUUID();
      const timeout=setTimeout(()=>{child.off('message',receive);reject(new Error('Inspection timed out'));},2000);
      function receive(message) {
        if(message.requestId!==requestId)return;
        clearTimeout(timeout);child.off('message',receive);resolve(message);
      }
      child.on('message',receive);child.send({kind:'inspect',requestId});
    });
  }
  const inspectAll=()=>Promise.all(children.map(inspect));
  try {
    for(const id of ids) {
      const env={...process.env,COMMS_URL:urls.wsUrl,COMMS_AGENT_TOKEN:'',SIM_TICK_MS:'25'};
      delete env.COMMS_OPERATOR_TOKEN;
      const child=fork(new URL('../sim-agent.js',import.meta.url),[id],{env,execArgv:[],stdio:['ignore','ignore','inherit','ipc']});
      children.push(child);
    }
    await until(async()=>{
      if(relay.snapshot().agents.length!==5)return false;
      return (await inspectAll()).every(a=>Object.keys(a.known).length===4);
    },'five separate processes exchanging state');
    log('PASS: five independent simulated agents exchanged resource state.');
    await control('/api/partitions',{groups});
    // A fault cannot recall frames already in flight.
    await new Promise(r=>setTimeout(r,100));
    const before=await inspectAll();
    await until(async()=>(await inspectAll()).every((a,i)=>a.steps>=before[i].steps+25),'independent progress in three partitions');
    const partitioned=await inspectAll();
    for(let i=0;i<ids.length;i++) {
      assert.equal(partitioned[i].minecraftConnected,true);
      assert.equal(partitioned[i].connected,true);
      for(const peer of ids.filter(id=>id!==ids[i])) {
        const sameGroup=groups.some(g=>g.includes(ids[i]) && g.includes(peer));
        const earlier=before[i].known[peer].stateVersion.revision,later=partitioned[i].known[peer].stateVersion.revision;
        if(sameGroup)assert.ok(later>earlier,`${ids[i]} must hear ${peer}`);
        else assert.equal(later,earlier,`${ids[i]} must not learn across a partition`);
      }
    }
    const graph=relay.snapshot().links;
    assert.equal(graph.filter(l=>l.canCommunicate).length,2);
    assert.ok(graph.every(l=>l.transportAvailable));
    log('PASS: three partitions kept different beliefs; all five work loops and simulated Minecraft connections continued.');
    await control('/api/isolation',{agentId:ids[4],isolated:true});
    await control('/api/partitions',{groups:[]});
    assert.equal(relay.snapshot().links.filter(l=>l.canCommunicate).length,6);
    assert.equal(state(ids[4]).communication.isolated,true);
    await until(()=>state(ids[4]).pendingMessages>0,'isolated backlog');
    log('PASS: restoring partitions preserved the separate individual isolation.');
    const target=Object.fromEntries((await inspectAll()).map(a=>[a.agentId,a.resourceVersion]));
    await control('/api/heal',{});
    await until(async()=>(await inspectAll()).every(a=>ids.filter(id=>id!==a.agentId)
      .every(id=>a.known[id]?.stateVersion.revision>=target[id])),'all five synchronize after recovery');
    assert.equal(relay.snapshot().links.filter(l=>l.canCommunicate).length,10);
    assert.ok(events.some(e=>e.kind==='link-failed') && events.some(e=>e.kind==='link-restored'));
    assert.ok(events.some(e=>e.kind==='message-delivered'));
    log('PASS: manual recovery restored all ten links; every agent received peers’ latest checkpoint versions.');
    const final=await inspectAll();
    return {agents:final.map(a=>({agent:a.agentId,steps:a.steps,knownPeers:Object.keys(a.known).length,
      minecraftConnected:a.minecraftConnected})),events:events.length};
  } finally {
    await Promise.all(children.map(child=>new Promise(resolve=>{
      if(child.exitCode!==null || child.signalCode!==null)return resolve();
      const force=setTimeout(()=>child.kill('SIGKILL'),2000);force.unref();
      child.once('exit',()=>{clearTimeout(force);resolve();});child.kill('SIGTERM');
    })));
    await relay.close();
  }
}
