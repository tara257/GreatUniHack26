import { TeamChannel } from '../channel.js';
import { AgentClient } from './agent-client.js';
import { TEAM_NAMES } from '../roster.js';
import { STATE_TYPES, validateMessage } from './protocol.js';

// Bridge existing local discoveries to peer messages. No movement, inventory transfer,
// task assignment, or Minecraft connection control is available to this class.
export class MinecraftChannel extends TeamChannel {
  constructor({agentId,state,save,learn,observe,log=()=>{},notice=()=>{},url,token,clientOptions={}}) {
    super({state,save,learn,send:()=>{}});
    this.agentId=agentId;this.observe=observe;this.log=log;this.notice=notice;
    this.transport='websocket';this.link={isolated:false,partition:null};this.closed=false;
    state.commsEpoch=(state.commsEpoch || 0)+1;
    state.peerReports ??= {};
    save(); // Persist the incarnation before publishing any state with its versions.
    this.client=new AgentClient({...clientOptions,agentId,url,token,stateEpoch:state.commsEpoch,
      onMessage:message=>this.accept(message)});
    for(const [key,message] of Object.entries(state.peerReports)) {
      try {
        validateMessage(message,message.from);
        if(TEAM_NAMES.includes(message.from) && STATE_TYPES.includes(message.type) && key===JSON.stringify([message.from,message.type]))
          this.client.peerState.set(key,message);
      } catch { delete state.peerReports[key]; }
    }
    this.client.on('ready',()=>{this.log('WebSocket relay connected; exchanging my own observations.');this.tick();});
    this.client.on('offline',()=>{if(!this.closed)this.log('Peer communication unavailable; my Minecraft work continues.');});
    this.client.on('linkState',link=>{
      const changed=this.link.isolated!==link.isolated || this.link.partition!==link.partition;
      this.link={isolated:link.isolated,partition:link.partition};
      if(changed)this.notice(link.isolated?'My peer messages are isolated; continuing local work.':
        link.partition!==null?`Peer network partition ${link.partition}; continuing local work.`:'Peer links restored; exchanging discoveries.');
    });
    this.client.on('handlerError',({error})=>{if(this.online)this.log(`Peer report rejected: ${error.message}`);});
    this.client.on('publishRejected',event=>{
      if(!['STALE_STATE','CLIENT_CLOSED'].includes(event.code))this.log(`Message ${event.code}; gameplay continues.`);
    });
    if(this.online){this.tick();this.client.start();}
  }
  get summary() {
    if(!this.online)return 'OFF locally (Minecraft still connected)';
    if(!this.client.ready)return 'relay offline';
    if(this.link.isolated)return 'ISOLATED';
    return this.link.partition===null?'connected':`partition ${this.link.partition}`;
  }
  // Never learn peer data through Minecraft chat in WebSocket mode.
  receive() {return false;}
  accept(message) {
    if(!this.online)throw new Error('Local communication disabled'); // Do not ACK/advance the watermark.
    if(message.from===this.agentId || !TEAM_NAMES.includes(message.from))return;
    if(message.type==='RESOURCE_UPDATE') {
      const discoveries=message.payload.discoveries ?? [];
      if(!Array.isArray(discoveries) || discoveries.length>32)throw new Error('Invalid discovery snapshot');
      for(const event of discoveries) {
        if(!event || !Array.isArray(event.position) || event.position.length!==3 ||
          !/^[a-f0-9]{8}$/.test(event.id) || !/^(Wood|Stone|Sand|Water|Coal|Iron|Danger|Death|Blocked|Food|Claim|Built)$/.test(event.kind) ||
          !event.position.every(n=>Number.isSafeInteger(n) && Math.abs(n)<=30_000_000) ||
          !Number.isSafeInteger(event.time) || event.time<0 || event.time>Date.now()+5000)continue;
        // Reuse the same freshness, deduplication, and bounded local-memory rules.
        super.receive(message.from,`[TEAM ${event.id}] ${event.kind} at ${event.position.join(' ')} @${event.time}`);
      }
    }
    if(STATE_TYPES.includes(message.type)) {
      this.state.peerReports[JSON.stringify([message.from,message.type])]=JSON.parse(JSON.stringify(message));
      this.save(); // Persist the received version together with the resulting local knowledge before ACK.
    }
  }
  publish(kind,position) {
    const event=super.publish(kind,position);
    this.queue.length=0; // The own-state snapshot is the replay source, not the old chat queue.
    return event;
  }
  tick() {
    if(!this.online || this.closed)return;
    const observation=this.observe();
    this.client.publish('STATUS_UPDATE',observation.status);
    this.client.publish('RESOURCE_UPDATE',{resources:observation.resources,
      discoveries:this.state.history.filter(event=>this.fresh(event)).slice(-32)});
  }
  setOnline(online) {
    if(this.online===online)return;
    this.online=online;this.state.commsOnline=online;this.save();
    if(online){this.tick();this.client.start();}
    else this.client.close(); // Only the relay socket; never the Minecraft connection.
  }
  close() {this.closed=true;this.client.close();}
}
