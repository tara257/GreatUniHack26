import { AgentClient } from '../src/comms/agent-client.js';

const agentId=process.argv[2] || 'Ember';
const tickMs=Number(process.env.SIM_TICK_MS || 100);
if(!Number.isInteger(tickMs) || tickMs<10)throw new Error('SIM_TICK_MS must be at least 10');
let steps=0,wood=0;
const known=new Map();
const client=new AgentClient({agentId,url:process.env.COMMS_URL || 'ws://127.0.0.1:8090/agents',token:process.env.COMMS_AGENT_TOKEN || '',
  onMessage:async message=>{
    known.set(message.from,{type:message.type,id:message.id,
      resources:message.type==='RESOURCE_UPDATE'?message.payload.resources:known.get(message.from)?.resources,
      stateVersion:message.stateVersion,sentAt:message.sentAt});
    if(message.type==='RESOURCE_REQUEST')client.publish('RESOURCE_UPDATE',{resources:{oak_log:wood}},{to:message.from,correlationId:message.id});
    console.log(JSON.stringify({agentId,event:'received',from:message.from,type:message.type,id:message.id,stateVersion:message.stateVersion}));
  }});
client.on('ready',()=>{
  console.log(JSON.stringify({agentId,event:'online'}));
  publishStatus(); // Re-advertise this agent's own state after a relay restart.
});
client.on('offline',()=>console.log(JSON.stringify({agentId,event:'offline',steps})));
client.on('publishRejected',e=>console.log(JSON.stringify({agentId,event:'publish-rejected',...e})));
client.on('stateIgnored',e=>console.log(JSON.stringify({agentId,event:'state-ignored',from:e.message.from,reason:e.reason})));
function publishStatus() {
  client.publish('STATUS_UPDATE',{minecraft:{connected:true},health:20,hunger:20,task:'simulated-wood-gathering',
    details:{simulated:true,steps,knownAgents:[...known.keys()],
      knownResources:Object.fromEntries([...known].filter(([,v])=>v.resources).map(([id,v])=>[id,v.resources]))}},{to:'@relay'});
}
// This independent local loop deliberately does not await communication.
const work=setInterval(()=>{
  steps++;if(steps%3===0)wood++;
  if(steps%5===0)publishStatus();
  if(steps%10===0)client.publish('RESOURCE_UPDATE',{resources:{oak_log:wood}});
},tickMs);
// Test/operator inspection only. These snapshots never go back into another agent.
process.on('message',message=>{
  if(message?.kind==='inspect')process.send?.({kind:'inspection',requestId:message.requestId,agentId,steps,wood,
    minecraftConnected:true,connected:client.ready,known:Object.fromEntries(known),
    resourceVersion:client.revisions.get('RESOURCE_UPDATE') || 0});
});
client.start();
let stopping=false;
function stop(){if(stopping)return;stopping=true;clearInterval(work);client.close();if(process.connected)process.disconnect();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
