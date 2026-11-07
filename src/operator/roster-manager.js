import { ROSTER, ROLES } from '../roster.js';

// Human-operated process lifecycle. No Minecraft observations or role decisions enter here.
export class RosterManager {
  constructor({spawn,save=()=>{},stopTimeoutMs=2000}) {this.spawn=spawn;this.save=save;this.stopTimeoutMs=stopTimeoutMs;this.children=new Map();this.selected=[];this.queue=Promise.resolve();this.stopping=false;}
  status() {return {available:true,roles:ROSTER.map(a=>({...a,selected:this.selected.includes(a.role),processRunning:this.children.has(a.role)}))};}
  apply(roles,{autostart=true}={}) {
    if(!Array.isArray(roles) || new Set(roles).size!==roles.length || roles.some(role=>!ROLES.includes(role)))return Promise.reject(new Error('Invalid roles'));
    const next=[...roles];
    const operation=this.queue.then(async()=>{
      if(this.stopping)throw new Error('Launcher is stopping');
      for(const [role,child] of this.children)if(!next.includes(role))await this.stopChild(role,child);
      for(const member of ROSTER.filter(a=>next.includes(a.role)))if(!this.children.has(member.role)) {
        const child=this.spawn(member,{autostart});this.children.set(member.role,child);
        child.once('exit',()=>{if(this.children.get(member.role)===child)this.children.delete(member.role);});
      }
      this.selected=next;this.save(next);return this.status();
    });
    this.queue=operation.catch(()=>{});return operation;
  }
  command(command) {
    if(!['start','pause','status','comms off','comms on'].includes(command))throw new Error('Unknown bot command');
    for(const child of this.children.values())if(child.connected)child.send({type:'control',command});
    return this.status();
  }
  async stopChild(role,child) {
    await new Promise(resolve=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');},this.stopTimeoutMs);
      child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
    });
    if(this.children.get(role)===child)this.children.delete(role);
  }
  async close() {this.stopping=true;await this.queue;await Promise.all([...this.children].map(([role,child])=>this.stopChild(role,child)));}
}
