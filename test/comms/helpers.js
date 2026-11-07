import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createRelay } from '../../src/comms/relay.js';

export async function eventually(predicate,label='condition',timeout=4000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) { const result=await predicate();if(result)return result;await new Promise(r=>setTimeout(r,5)); }
  throw new Error(`Timed out waiting for ${label}`);
}
export async function fixture(t,options={}) {
  const relay=createRelay({port:0,operatorToken:'test-operator',sweepMs:10,ackRetryMs:40,...options});
  const urls=await relay.listen(),clients=[];
  t.after(async()=>{for(const c of clients)c.close?c.close():c.ws?.terminate();await relay.close();});
  async function control(path,body) {
    const response=await fetch(urls.httpUrl+path,{method:'POST',headers:{Authorization:'Bearer test-operator','content-type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw new Error(JSON.stringify(await response.json()));return response.json();
  }
  return {relay,urls,clients,control,
    async agent(id,opts={}) { const a=await rawAgent(urls.wsUrl,id,opts);clients.push(a);return a; }};
}
export async function rawAgent(url,id,{autoAck=true,autoPong=true,token='',register=true}={}) {
  const frames=[],ws=new WebSocket(url,{autoPong,headers:token?{Authorization:`Bearer ${token}`}:{}});
  const client={ws,frames,closed:false,close(){ws.terminate();},
    send(data){ws.send(JSON.stringify(data));},
    wait(kind,predicate=()=>true){return eventually(()=>frames.find(f=>f.kind===kind && predicate(f)),kind);},
    publish(type,payload,{to='*',ttlMs=3000,id=randomUUID(),sentAt=Date.now(),...extra}={}) {
      const message={id,type,to,ttlMs,sentAt,payload,...extra};this.send({v:1,kind:'PUBLISH',message});return message;
    },
    messages(id){return frames.filter(f=>f.kind==='MESSAGE' && (!id || f.message.id===id));},
    async barrier(){const m=this.publish('HEARTBEAT',{}, {to:'@relay'});await this.wait('PUBLISH_ACK',f=>f.id===m.id);},
  };
  ws.on('message',data=>{
    const input=JSON.parse(data);frames.push(input);
    if(input.kind==='MESSAGE' && autoAck)client.send({v:1,kind:'ACK',from:input.message.from,id:input.message.id});
  });
  ws.on('close',code=>{client.closed=true;client.closeCode=code;});
  ws.on('error',error=>{client.error=error;});
  await eventually(()=>ws.readyState===WebSocket.OPEN || client.error,'socket open');
  if(client.error)throw client.error;
  if(register){client.send({v:1,kind:'REGISTER',agentId:id});await client.wait('REGISTERED');}
  return client;
}
