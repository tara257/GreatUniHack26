import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { VERSION, LIMITS, STATE_TYPES, compareState, validateMessage, validId, object, canonical } from './protocol.js';

// Optional communication adapter: no Minecraft import, planning, or movement.
// Transport errors are ordinary events, never EventEmitter's fatal 'error' event.
export class AgentClient extends EventEmitter {
  constructor({agentId,url='ws://127.0.0.1:8090/agents',token='',onMessage=async()=>{},
    reconnectMinMs=300,reconnectMaxMs=5000,retryMs=1000,heartbeatMs,
    maxOutbox=256,maxReceived=4096,maxBufferedBytes=1_048_576,stateEpoch=1,maxStateStreams=128}={}) {
    super();
    if(!validId(agentId))throw new Error('A valid agentId is required');
    if(!Number.isSafeInteger(stateEpoch) || stateEpoch<1)throw new Error('stateEpoch must be a positive persisted incarnation counter');
    Object.assign(this,{agentId,url,token,onMessage,reconnectMinMs,reconnectMaxMs,retryMs,heartbeatMs,maxOutbox,maxReceived,maxBufferedBytes,stateEpoch,maxStateStreams});
    this.outbox=new Map();this.received=new Map();this.processing=new Set();
    this.revisions=new Map();this.ownState=new Map();this.peerState=new Map();this.stateChains=new Map();
    this.running=false;this.ready=false;this.attempt=0;this.serverId=null;
  }
  start() {
    if(this.running)return this;
    this.running=true;this.startedAt=Date.now();
    this.pumpTimer=setInterval(()=>this.pump(),Math.max(20,Math.min(this.retryMs,250)));this.pumpTimer.unref();
    this.connect();return this;
  }
  connect() {
    if(!this.running)return;
    const socket=new WebSocket(this.url,{perMessageDeflate:false,maxPayload:LIMITS.maxPayloadBytes*2,
      handshakeTimeout:5000,headers:this.token?{Authorization:`Bearer ${this.token}`}:{}});
    this.socket=socket;
    const registrationTimer=setTimeout(()=>{if(!this.ready)socket.terminate();},6000);registrationTimer.unref();
    socket.on('open',()=>this.write(socket,{v:VERSION,kind:'REGISTER',agentId:this.agentId}));
    socket.on('error',error=>this.emit('connectionError',error));
    socket.on('message',raw=>{
      let input;
      try { input=JSON.parse(raw.toString()); } catch { this.emit('protocolError',new Error('Relay sent invalid JSON'));return; }
      if(!object(input) || input.v!==VERSION)return this.emit('protocolError',new Error('Unsupported relay frame'));
      if(input.kind==='REGISTERED') {
        clearTimeout(registrationTimer);
        const changed=this.serverId!==null && this.serverId!==input.serverId;
        this.serverId=input.serverId;this.ready=true;this.attempt=0;
        for(const pending of this.outbox.values())pending.lastAttemptAt=0;
        const interval=this.heartbeatMs ?? input.heartbeatIntervalMs;
        clearInterval(this.heartbeatTimer);
        if(interval>0) {
          const heartbeat=()=>{if(this.ready)this.publish('HEARTBEAT',{uptimeMs:Date.now()-this.startedAt},{to:'@relay',ttlMs:15_000});};
          this.heartbeatTimer=setInterval(heartbeat,interval);this.heartbeatTimer.unref();heartbeat();
        }
        this.emit('ready',{...input,serverChanged:changed});this.pump();this.scheduleStateSync();
      } else if(input.kind==='PUBLISH_ACK') {
        this.outbox.delete(input.id);this.emit('accepted',input);
      } else if(input.kind==='MESSAGE') {
        void this.receive(socket,input);
      } else if(input.kind==='ERROR') {
        const pending=this.outbox.get(input.id);
        if(pending && !input.retryable) { this.outbox.delete(input.id);this.emit('publishRejected',input); }
        else this.emit('relayError',input);
      } else if(input.kind==='DELIVERY_STATUS')this.emit('deliveryStatus',input);
      else if(input.kind==='LINK_STATE') {this.emit('linkState',input);this.scheduleStateSync();}
    });
    socket.on('close',(code,reason)=>{
      clearTimeout(registrationTimer);
      if(this.socket!==socket)return;
      this.ready=false;clearInterval(this.heartbeatTimer);
      this.emit('offline',{code,reason:reason.toString()});
      if(this.running) {
        const delay=Math.min(this.reconnectMaxMs,this.reconnectMinMs*2**Math.min(this.attempt++,8));
        this.reconnectTimer=setTimeout(()=>this.connect(),delay+Math.random()*delay*0.2);this.reconnectTimer.unref();
      }
    });
  }
  write(socket,data) {
    if(socket?.readyState!==WebSocket.OPEN || socket.bufferedAmount>this.maxBufferedBytes)return false;
    socket.send(JSON.stringify(data),error=>{if(error)socket.terminate();});return true;
  }
  publish(type,payload,{to='*',id=randomUUID(),ttlMs=LIMITS.defaultTtlMs,correlationId}={}) {
    const isState=STATE_TYPES.includes(type),revision=(this.revisions.get(type) || 0)+1;
    const stateVersion=isState?{epoch:this.stateEpoch,revision}:undefined;
    const message=validateMessage({id,type,to,sentAt:Date.now(),ttlMs,correlationId,payload,stateVersion},this.agentId);
    // Detach caller-owned objects so later inventory mutations cannot alter retries.
    const copy=JSON.parse(JSON.stringify(message));
    if(Buffer.byteLength(JSON.stringify({v:VERSION,kind:'PUBLISH',message:copy}))>LIMITS.maxPayloadBytes)throw new Error('Message exceeds maximum frame size');
    if(this.outbox.has(id))throw new Error('Message ID already exists in the local outbox');
    if(isState) {
      const key=JSON.stringify([type,to]);
      if(!this.ownState.has(key) && this.ownState.size>=this.maxStateStreams)throw new Error('Local state stream limit reached');
      this.revisions.set(type,revision);
      this.ownState.set(key,copy);
    }
    return this.enqueue(copy);
  }
  enqueue(copy) {
    const {id,ttlMs}=copy;
    if(this.outbox.has(id))throw new Error('Message ID already exists in the local outbox');
    if(this.outbox.size>=this.maxOutbox) {
      this.emit('publishRejected',{id,code:'OUTBOX_FULL',message:'Local outbox is full',mayHaveBeenAccepted:false});return id;
    }
    this.outbox.set(id,{message:copy,expiresAt:Date.now()+ttlMs,lastAttemptAt:0,attempted:false});
    this.pump();return id;
  }
  scheduleStateSync(delay=30) {
    if(this.syncTimer || !this.running)return;
    this.syncTimer=setTimeout(()=>{
      this.syncTimer=null;if(!this.ready)return;
      let retry=false;
      for(const message of this.ownState.values()) {
        // Preserve source version, observation time, and original audience.
        // The relay never synthesizes a state update or reads another agent's memory.
        if(![...this.outbox.values()].some(p=>p.message.type===message.type && p.message.to===message.to && compareState(p.message,message)>=0)) {
          if(this.outbox.size>=this.maxOutbox){retry=true;continue;}
          this.enqueue({...message,id:randomUUID()});
        }
      }
      this.emit('stateSync',{streams:this.ownState.size});
      if(retry)this.scheduleStateSync(this.retryMs);
    },delay);this.syncTimer.unref();
  }
  pump() {
    const now=Date.now();
    for(const [id,pending] of this.outbox) {
      if(pending.expiresAt<=now) {
        this.outbox.delete(id);
        this.emit('publishRejected',{id,code:'OUTBOX_EXPIRED',message:'No acceptance ACK before local deadline',mayHaveBeenAccepted:pending.attempted});
        continue;
      }
      if(!this.ready || now-pending.lastAttemptAt<this.retryMs)continue;
      if(this.write(this.socket,{v:VERSION,kind:'PUBLISH',message:pending.message})) {
        pending.lastAttemptAt=now;pending.attempted=true;
      }
    }
    for(const [key,expires] of this.received)if(expires<=now)this.received.delete(key);
  }
  async receive(socket,input) {
    try { if(!validId(input.message?.from))throw new Error('Invalid sender');validateMessage(input.message,input.message.from); }
    catch(error) { this.emit('protocolError',error);return; }
    const message=input.message,key=JSON.stringify([message.from,message.id]);
    const acknowledge=()=>this.write(socket,{v:VERSION,kind:'ACK',id:message.id,from:message.from});
    if(this.received.has(key)) { acknowledge();return; }
    if(this.processing.has(key))return;
    if(this.processing.size>=this.maxReceived)return; // No ACK: bounded backpressure, relay retries.
    this.processing.add(key);
    const isState=STATE_TYPES.includes(message.type),stream=JSON.stringify([message.from,message.type]);
    const handle=async()=>{
      try {
        const previous=this.peerState.get(stream),order=isState?compareState(message,previous):1;
        if(isState && order<=0) {
          const reason=order<0?'stale':canonical(previous.payload)===canonical(message.payload)?'duplicate-state':'version-conflict';
          this.emit('stateIgnored',{message,reason});acknowledge();return;
        }
        if(isState && !previous && this.peerState.size>=this.maxStateStreams)throw new Error('Peer state stream limit reached');
        await this.onMessage(message,input.relay);
        // Keep watermarks for this adapter's lifetime; expiring them could revive old state.
        if(isState)this.peerState.set(stream,JSON.parse(JSON.stringify(message)));
        this.received.set(key,Date.now()+LIMITS.maxTtlMs+60_000);
        if(this.received.size>this.maxReceived)this.received.delete(this.received.keys().next().value);
        acknowledge();this.emit('message',message);
      } catch(error) { this.emit('handlerError',{error,message}); }
      finally { this.processing.delete(key); }
    };
    if(!isState)return handle();
    // Serialize handlers for each source/type: a slow older callback cannot finish last.
    const chain=(this.stateChains.get(stream) || Promise.resolve()).then(handle);
    this.stateChains.set(stream,chain);
    await chain;
    if(this.stateChains.get(stream)===chain)this.stateChains.delete(stream);
  }
  close() {
    this.running=false;this.ready=false;
    clearTimeout(this.reconnectTimer);clearTimeout(this.syncTimer);this.syncTimer=null;
    clearInterval(this.heartbeatTimer);clearInterval(this.pumpTimer);
    for(const [id,pending] of this.outbox)this.emit('publishRejected',{id,code:'CLIENT_CLOSED',mayHaveBeenAccepted:pending.attempted});
    this.outbox.clear();this.socket?.terminate();
  }
}
