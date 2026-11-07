import { createServer } from 'node:http';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { VERSION, LIMITS, ProtocolError, requireThat, validateMessage, canonical, validId, object } from './protocol.js';

const equalToken=(a,b)=>{
  if(typeof a!=='string')return false;
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
};
const pairKey=(a,b)=>JSON.stringify([a,b].sort());
const messageKey=(from,id)=>JSON.stringify([from,id]);
const frame=(kind,data={})=>({v:VERSION,kind,...data});

export function createRelay(options={}) {
  const config={host:'127.0.0.1',port:8090,maxAgents:64,maxPendingPerAgent:128,maxRecords:4096,
    maxBufferedBytes:1_048_576,ackRetryMs:1500,sweepMs:250,pingIntervalMs:10_000,pongTimeoutMs:30_000,
    heartbeatIntervalMs:5000,heartbeatStaleMs:15_000,statusStaleMs:15_000,registrationTimeoutMs:5000,
    dedupeRetentionMs:60_000,agentToken:'',operatorToken:randomBytes(24).toString('hex'),...options};
  if (!config.operatorToken) throw new Error('An operator token is required');
  if (!['127.0.0.1','::1','localhost'].includes(config.host) && (!config.agentToken || !options.operatorToken)) {
    throw new Error('Non-loopback binding requires explicit agentToken and operatorToken');
  }
  const serverId=randomUUID(),agents=new Map(),records=new Map(),observers=new Set(),disabledLinks=new Set();
  let partitions=null,closing=false,timer,pingTimer,revision=0,dirty=false;
  const events=[];
  const counters={accepted:0,delivered:0,expired:0,rejected:0};
  const wss=new WebSocketServer({noServer:true,maxPayload:LIMITS.maxPayloadBytes,perMessageDeflate:false});
  function changed(kind,data={}) {
    revision++; dirty=true;
    events.push({at:Date.now(),kind,...data});
    if(events.length>200)events.shift();
  }
  function send(ws,data) {
    if (!ws || ws.readyState!==WebSocket.OPEN) return false;
    if (ws.bufferedAmount>config.maxBufferedBytes) { ws.close(1013,'Slow consumer; reconnect to replay'); return false; }
    ws.send(JSON.stringify(data),error=>{if(error)ws.terminate();});
    return true;
  }
  function fail(ws,error,id) {
    counters.rejected++;
    send(ws,frame('ERROR',{code:error.code || 'INVALID_MESSAGE',message:error.message,retryable:!!error.retryable,...(id?{id}:{})}));
  }
  function agent(id) {
    const a=agents.get(id);
    if(!a)throw new ProtocolError('UNKNOWN_AGENT',`Unknown agent: ${id}`);
    return a;
  }
  function linkReasons(from,to) {
    const reasons=[];
    if(agents.get(from)?.isolated || agents.get(to)?.isolated)reasons.push('isolated');
    if(partitions && (partitions.get(from) ?? 'unassigned')!==(partitions.get(to) ?? 'unassigned'))reasons.push('partition');
    if(disabledLinks.has(pairKey(from,to)))reasons.push('link-disabled');
    return reasons;
  }
  function selfLink(a) { return {isolated:a.isolated,partition:partitions?(partitions.get(a.id) ?? 'unassigned'):null}; }
  function report(value,now) {
    return value?{...value,ageMs:now-value.receivedAt,stale:now-value.receivedAt>config.statusStaleMs}:null;
  }
  function snapshot() {
    const now=Date.now();
    return {v:VERSION,serverId,revision,at:now,counters:{...counters},
      limits:{...LIMITS,maxAgents:config.maxAgents,maxPendingPerAgent:config.maxPendingPerAgent,maxRecords:config.maxRecords},
      partitionActive:partitions!==null,
      agents:[...agents.values()].map(a=>({id:a.id,
        connection:{state:a.ws?'connected':'disconnected',connectedAt:a.connectedAt,disconnectedAt:a.disconnectedAt,
          lastSeenAt:a.lastSeenAt,lastPongAt:a.lastPongAt,lastDisconnect:a.lastDisconnect},
        heartbeat:{lastReceivedAt:a.lastHeartbeatAt,stale:!a.lastHeartbeatAt || now-a.lastHeartbeatAt>config.heartbeatStaleMs},
        communication:{...selfLink(a),blockedPeers:[...agents.keys()].filter(id=>id!==a.id && linkReasons(a.id,id).length)},
        minecraft:a.minecraft?report(a.minecraft,now):{value:'unknown',reportedAt:null,receivedAt:null,ageMs:null,stale:true},
        reports:Object.fromEntries(Object.entries(a.reports).map(([type,r])=>[type,report(r,now)])),
        pendingMessages:a.pending.size})),
      links:[...agents.keys()].flatMap((a,i,ids)=>ids.slice(i+1).map(b=>({a,b,blockedBy:linkReasons(a,b),
        transportAvailable:!!agents.get(a).ws && !!agents.get(b).ws}))),recentEvents:[...events]};
  }
  function outcome(record,recipient,status) {
    record.deliveries.set(recipient,status);
    changed(`message-${status}`,{from:record.message.from,to:recipient,id:record.message.id,type:record.message.type});
    send(agents.get(record.message.from)?.ws,frame('DELIVERY_STATUS',{id:record.message.id,recipient,status}));
    counters[status==='delivered'?'delivered':'expired']++;
  }
  function sweep() {
    const now=Date.now();
    for(const a of agents.values())for(const [key,pending] of a.pending) {
      const r=pending.record;
      if(r.expiresAt<=now) { a.pending.delete(key); outcome(r,a.id,'expired'); continue; }
      if(!a.ws || linkReasons(r.message.from,a.id).length)continue;
      if(pending.sessionId===a.sessionId && now-pending.lastSentAt<config.ackRetryMs)continue;
      if(send(a.ws,frame('MESSAGE',{message:r.message,relay:{serverId,acceptedAt:r.acceptedAt,expiresAt:r.expiresAt}}))) {
        pending.sessionId=a.sessionId; pending.lastSentAt=now;
      }
    }
    for(const [key,r] of records)if(now>r.expiresAt+config.dedupeRetentionMs)records.delete(key);
    if(dirty) {
      dirty=false;
      for(const ws of observers)send(ws,frame('SNAPSHOT',{state:snapshot()}));
    }
  }
  function acknowledge(a,input) {
    requireThat(typeof input.id==='string' && validId(input.from),'ACK requires id and from');
    const key=messageKey(input.from,input.id),pending=a.pending.get(key);
    if(!pending)return; // ACKs are idempotent, including ACKs arriving after TTL.
    // Never accept an ACK for a message not sent to this session.
    if(pending.sessionId!==a.sessionId)throw new ProtocolError('INVALID_ACK','Message was not delivered to this session');
    if(pending.record.expiresAt<=Date.now()) {
      a.pending.delete(key); outcome(pending.record,a.id,'expired'); return;
    }
    a.pending.delete(key); outcome(pending.record,a.id,'delivered');
  }
  function publish(a,input) {
    const message=validateMessage(input,a.id),key=messageKey(a.id,message.id),fingerprint=canonical(message);
    const old=records.get(key);
    if(old) {
      if(old.fingerprint!==fingerprint)throw new ProtocolError('ID_REUSE','A message ID cannot be reused for different content');
      send(a.ws,frame('PUBLISH_ACK',{id:message.id,status:'duplicate',expiresAt:old.expiresAt,deliveries:Object.fromEntries(old.deliveries)})); return;
    }
    const recipients=message.to==='*'?[...agents.keys()].filter(id=>id!==a.id):message.to==='@relay'?[]:[message.to];
    for(const id of recipients)if(!agents.has(id))throw new ProtocolError('UNKNOWN_RECIPIENT',`Register recipient ${id} before publishing to it`,true);
    if(records.size>=config.maxRecords || recipients.some(id=>agents.get(id).pending.size>=config.maxPendingPerAgent)) {
      throw new ProtocolError('QUEUE_FULL','Relay capacity reached; entire publish rejected, retry later',true);
    }
    const acceptedAt=Date.now(),record={message,fingerprint,acceptedAt,expiresAt:acceptedAt+message.ttlMs,
      deliveries:new Map(recipients.map(id=>[id,'queued']))};
    records.set(key,record);
    for(const id of recipients)agents.get(id).pending.set(key,{record,lastSentAt:0,sessionId:null});
    a.reports[message.type]={payload:message.payload,reportedAt:message.sentAt,receivedAt:acceptedAt};
    if(message.type==='HEARTBEAT')a.lastHeartbeatAt=acceptedAt;
    if(message.type==='STATUS_UPDATE' && message.payload.minecraft) {
      a.minecraft={value:message.payload.minecraft.connected?'connected':'disconnected',reportedAt:message.sentAt,receivedAt:acceptedAt};
    }
    counters.accepted++;
    changed('message-accepted',{from:a.id,id:message.id,type:message.type,recipients});
    send(a.ws,frame('PUBLISH_ACK',{id:message.id,status:'accepted',expiresAt:record.expiresAt,deliveries:Object.fromEntries(record.deliveries)}));
    sweep();
  }
  function networkChanged() {
    changed('network-changed');
    for(const a of agents.values())send(a.ws,frame('LINK_STATE',selfLink(a)));
    sweep();
  }
  function setIsolation(id,isolated) {
    requireThat(typeof isolated==='boolean','isolated must be boolean');
    agent(id).isolated=isolated; networkChanged();
  }
  function setPartitions(groups) {
    requireThat(Array.isArray(groups) && groups.every(Array.isArray),'groups must be arrays of agent IDs');
    const next=new Map();
    groups.forEach((group,index)=>{
      requireThat(group.length>0,'partition groups cannot be empty');
      for(const id of group) { agent(id); requireThat(!next.has(id),'an agent can occur in only one partition'); next.set(id,String(index)); }
    });
    partitions=groups.length?next:null; networkChanged();
  }
  function setLink(a,b,enabled) {
    agent(a);agent(b);
    requireThat(a!==b && typeof enabled==='boolean','provide distinct a/b and boolean enabled');
    const key=pairKey(a,b); if(enabled)disabledLinks.delete(key);else disabledLinks.add(key);
    networkChanged();
  }
  function json(res,status,body) { res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body)); }
  function readBody(req) {
    return new Promise((resolve,reject)=>{
      let body='',size=0,over=false;
      req.on('data',chunk=>{
        size+=chunk.length;
        if(size>LIMITS.maxPayloadBytes) { if(!over)reject(new ProtocolError('TOO_LARGE','Request body too large'));over=true;return; }
        body+=chunk;
      });
      req.on('end',()=>{if(over)return;try{resolve(JSON.parse(body));}catch{reject(new ProtocolError('INVALID_JSON','Expected JSON body'));}});
      req.on('error',reject);
    });
  }
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://relay.local').pathname;
    if(req.method==='GET' && path==='/health')return json(res,200,{ok:true,service:'Autonomous Colony relay',v:VERSION,serverId});
    if(!equalToken(req.headers.authorization,`Bearer ${config.operatorToken}`))return json(res,401,{error:'UNAUTHORIZED'});
    try {
      if(req.method==='GET' && path==='/api/state')return json(res,200,snapshot());
      if(req.method==='POST' && ['/api/isolation','/api/partitions','/api/links'].includes(path)) {
        const body=await readBody(req); requireThat(object(body),'Expected an object');
        if(path==='/api/isolation')setIsolation(body.agentId,body.isolated);
        if(path==='/api/partitions')setPartitions(body.groups);
        if(path==='/api/links')setLink(body.a,body.b,body.enabled);
        return json(res,200,snapshot());
      }
      json(res,404,{error:'NOT_FOUND'});
    } catch(error) { json(res,error.code==='TOO_LARGE'?413:error.code==='UNKNOWN_AGENT'?404:400,{error:error.code || 'INVALID_REQUEST',message:error.message}); }
  });
  server.requestTimeout=10_000;
  server.on('upgrade',(req,socket,head)=>{
    socket.on('error',()=>{});
    const path=new URL(req.url,'http://relay.local').pathname;
    const reject=(code)=>{socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`);socket.destroy();};
    if(closing || wss.clients.size>=config.maxAgents*2)return reject('503 Service Unavailable');
    if(!['/agents','/observe'].includes(path))return reject('404 Not Found');
    if(path==='/agents' && config.agentToken && !equalToken(req.headers.authorization,`Bearer ${config.agentToken}`))return reject('401 Unauthorized');
    // Browser pages do not get an unauthenticated path into the local agent bus.
    if(path==='/agents' && req.headers.origin)return reject('403 Forbidden');
    wss.handleUpgrade(req,socket,head,ws=>connected(ws,path));
  });
  function connected(ws,path) {
    let registered=null,observing=false;
    ws.lastPong=Date.now();
    const registrationTimer=setTimeout(()=>ws.close(1008,'Registration timed out'),config.registrationTimeoutMs);
    registrationTimer.unref();
    ws.on('error',()=>{});
    ws.on('pong',()=>{ws.lastPong=Date.now();if(registered)registered.lastPongAt=ws.lastPong;});
    ws.on('message',(data,binary)=>{
      let input;
      try {
        requireThat(!binary,'Only JSON text frames are supported');
        try{input=JSON.parse(data.toString());}catch{throw new ProtocolError('INVALID_JSON','Expected a JSON frame');}
        requireThat(object(input) && input.v===VERSION,'Unsupported protocol version');
        if(path==='/observe') {
          if(observing)throw new ProtocolError('READ_ONLY','Observer connections are read-only');
          if(input.kind!=='SUBSCRIBE' || !equalToken(input.token,config.operatorToken)) {
            fail(ws,new ProtocolError('UNAUTHORIZED','Operator token required'));ws.close(1008,'Unauthorized');return;
          }
          observing=true;clearTimeout(registrationTimer);observers.add(ws);
          send(ws,frame('SNAPSHOT',{state:snapshot()}));return;
        }
        if(!registered) {
          requireThat(input.kind==='REGISTER' && validId(input.agentId),'REGISTER with a valid agentId first');
          const existing=agents.get(input.agentId);
          if(existing?.ws) { fail(ws,new ProtocolError('ID_IN_USE','Agent ID already has a connection',true));ws.close(1008,'ID in use');return; }
          if(!existing && agents.size>=config.maxAgents)throw new ProtocolError('AGENT_LIMIT','Agent registry is full');
          registered=existing || {id:input.agentId,isolated:false,pending:new Map(),reports:{},minecraft:null,lastHeartbeatAt:null};
          Object.assign(registered,{ws,sessionId:randomUUID(),connectedAt:Date.now(),disconnectedAt:null,lastSeenAt:Date.now(),lastPongAt:null});
          agents.set(registered.id,registered);clearTimeout(registrationTimer);
          changed('agent-connected',{agentId:registered.id});
          send(ws,frame('REGISTERED',{agentId:registered.id,sessionId:registered.sessionId,serverId,
            heartbeatIntervalMs:config.heartbeatIntervalMs,limits:LIMITS,link:selfLink(registered)}));
          sweep();return;
        }
        registered.lastSeenAt=Date.now();
        if(input.kind==='PUBLISH')publish(registered,input.message);
        else if(input.kind==='ACK')acknowledge(registered,input);
        else throw new ProtocolError('INVALID_FRAME','Expected PUBLISH or ACK');
      } catch(error) { fail(ws,error,typeof input?.message?.id==='string'?input.message.id:undefined); }
    });
    ws.on('close',(code,reason)=>{
      clearTimeout(registrationTimer);observers.delete(ws);
      if(registered?.ws===ws) {
        Object.assign(registered,{ws:null,disconnectedAt:Date.now(),lastDisconnect:{code,reason:reason.toString()}});
        changed('agent-disconnected',{agentId:registered.id,code});
      }
    });
  }
  return {
    serverId,operatorToken:config.operatorToken,snapshot,setIsolation,setPartitions,setLink,
    async listen() {
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(config.port,config.host,()=>{server.removeListener('error',reject);resolve();});
      });
      timer=setInterval(sweep,config.sweepMs);timer.unref();
      pingTimer=setInterval(()=>{
        for(const ws of wss.clients) {
          if(Date.now()-ws.lastPong>config.pongTimeoutMs)ws.terminate();
          else if(ws.readyState===WebSocket.OPEN)ws.ping();
        }
        // Refresh age/staleness in the observer stream even without new reports.
        for(const ws of observers)send(ws,frame('SNAPSHOT',{state:snapshot()}));
      },config.pingIntervalMs);pingTimer.unref();
      const address=server.address(),host=address.family==='IPv6'?`[${address.address}]`:address.address;
      return {httpUrl:`http://${host}:${address.port}`,wsUrl:`ws://${host}:${address.port}/agents`,observerUrl:`ws://${host}:${address.port}/observe`};
    },
    async close() {
      if(closing)return;closing=true;clearInterval(timer);clearInterval(pingTimer);
      for(const ws of wss.clients)ws.terminate();
      await new Promise(resolve=>wss.close(resolve));
      if(server.listening)await new Promise(resolve=>server.close(resolve));
    },
  };
}
