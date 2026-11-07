import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createRelay } from '../src/comms/relay.js';

const relay=createRelay({port:0}),urls=await relay.listen(),children=[],received=[];
async function until(predicate,label) {
  const deadline=Date.now()+8000;
  while(Date.now()<deadline) {if(predicate())return;await new Promise(r=>setTimeout(r,25));}
  throw new Error(`Demo timed out: ${label}`);
}
async function control(path,body) {
  const response=await fetch(urls.httpUrl+path,{method:'POST',headers:{Authorization:`Bearer ${relay.operatorToken}`,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200);return response.json();
}
function status(id) {return relay.snapshot().agents.find(a=>a.id===id);}
try {
  for(const id of ['Ember','Flint','Moss']) {
    const env={...process.env,COMMS_URL:urls.wsUrl,COMMS_AGENT_TOKEN:''};delete env.COMMS_OPERATOR_TOKEN;
    const child=fork(new URL('./sim-agent.js',import.meta.url),[id],{env,execArgv:[],stdio:['ignore','pipe','inherit','ipc']});
    children.push(child);let partial='';
    child.stdout.on('data',chunk=>{
      partial+=chunk.toString();const lines=partial.split('\n');partial=lines.pop();
      for(const line of lines){try{const e=JSON.parse(line);if(e.event==='received')received.push(e);}catch{}}
    });
  }
  await until(()=>relay.snapshot().agents.length===3 && relay.snapshot().agents.every(a=>a.reports.RESOURCE_UPDATE),'initial agent reports');
  console.log('PASS: three independent agent processes connected and exchanged resource reports.');
  await control('/api/partitions',{groups:[['Ember','Flint'],['Moss']]});
  const before=status('Moss').reports.STATUS_UPDATE.payload.details.steps;
  await until(()=>status('Moss').pendingMessages>=2 && status('Moss').reports.STATUS_UPDATE.payload.details.steps>=before+15,'progress during partition');
  assert.equal(status('Moss').connection.state,'connected');assert.equal(status('Moss').minecraft.value,'connected');
  console.log('PASS: Moss kept its socket and simulated Minecraft connection; local work advanced during the partition.');
  console.table(relay.snapshot().agents.map(a=>({agent:a.id,steps:a.reports.STATUS_UPDATE.payload.details.steps,
    pending:a.pendingMessages,knownResources:JSON.stringify(a.reports.STATUS_UPDATE.payload.details.knownResources)})));
  const previouslyReceived=received.filter(e=>e.agentId==='Moss').length;
  await control('/api/partitions',{groups:[]});
  await until(()=>received.filter(e=>e.agentId==='Moss').length>previouslyReceived && relay.snapshot().agents.every(a=>a.pendingMessages===0),'replay after healing');
  console.log('PASS: queued peer reports arrived and were acknowledged after healing.');
  await control('/api/isolation',{agentId:'Flint',isolated:true});
  await until(()=>status('Flint').pendingMessages>0,'isolated queue');
  assert.equal(status('Flint').connection.state,'connected');
  await control('/api/isolation',{agentId:'Flint',isolated:false});
  await until(()=>status('Flint').pendingMessages===0,'isolated queue replay');
  console.log('PASS: selected-agent isolation and recovery work independently of group partitions.');
} finally {
  await Promise.all(children.map(child=>new Promise(resolve=>{
    if(child.exitCode!==null)return resolve();
    child.once('exit',resolve);child.kill('SIGTERM');
    const force=setTimeout(()=>child.kill('SIGKILL'),2000);force.unref();
  })));
  await relay.close();
}
