import { AgentClient } from '../src/comms/agent-client.js';

const agentId=process.argv[2] || 'Ember';
let steps=0,wood=0;
const known=new Map();
const client=new AgentClient({agentId,url:process.env.COMMS_URL || 'ws://127.0.0.1:8090/agents',token:process.env.COMMS_AGENT_TOKEN || '',
  onMessage:async message=>{
    known.set(message.from,{type:message.type,id:message.id,
      resources:message.type==='RESOURCE_UPDATE'?message.payload.resources:known.get(message.from)?.resources});
    if(message.type==='RESOURCE_REQUEST')client.publish('RESOURCE_UPDATE',{resources:{oak_log:wood}},{to:message.from,correlationId:message.id});
    console.log(JSON.stringify({agentId,event:'received',from:message.from,type:message.type,id:message.id}));
  }});
client.on('ready',()=>{
  console.log(JSON.stringify({agentId,event:'online'}));
  publishStatus(); // Re-advertise this agent's own state after a relay restart.
});
client.on('offline',()=>console.log(JSON.stringify({agentId,event:'offline',steps})));
client.on('publishRejected',e=>console.log(JSON.stringify({agentId,event:'publish-rejected',...e})));
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
},100);
client.start();
let stopping=false;
function stop(){if(stopping)return;stopping=true;clearInterval(work);client.close();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
