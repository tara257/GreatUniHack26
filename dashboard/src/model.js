import { ROSTER } from '../../src/roster.js';
const colors={miner:'#a3b5d1',lumberjack:'#78c5a1',builder:'#edbd70',crafter:'#b3a0e4',scout:'#76bbd9'};
export const AGENTS=ROSTER.map(a=>({id:a.name,role:a.role,title:a.role[0].toUpperCase()+a.role.slice(1),name:a.name.split('_')[0],color:colors[a.role]}));
export const pretty=value=>String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export const age=(report,now)=>report?.receivedAt==null?null:Math.max(0,now-report.receivedAt);
export const stale=(report,now)=>!report || age(report,now)>15000;
export function ageText(ms) {if(ms==null)return 'No report';if(ms<2000)return 'Just now';if(ms<60000)return Math.floor(ms/1000)+'s ago';if(ms<3600000)return Math.floor(ms/60000)+'m ago';return Math.floor(ms/3600000)+'h ago';}
export function communication(agent) {
  if(!agent)return {label:'Not registered',tone:'muted'};
  if(agent.connection.state!=='connected')return {label:'Relay offline',tone:'muted'};
  if(agent.communication.isolated)return {label:'Isolated',tone:'warning'};
  if(agent.communication.partition!==null)return {label:'Partition '+(agent.communication.partition==='unassigned'?'unassigned':String.fromCharCode(65+Number(agent.communication.partition))),tone:'warning'};
  if(agent.communication.blockedPeers.length)return {label:'Links blocked',tone:'warning'};
  return {label:'Connected',tone:'good'};
}
export function inventories(agents,now) {
  const totals={},sources=[];let staleCount=0;
  for(const agent of agents) {
    const report=agent.reports?.RESOURCE_UPDATE;
    if(stale(report,now) || agent.minecraft?.value!=='connected' || stale(agent.minecraft,now)){staleCount++;continue;}
    sources.push(agent.id);
    for(const [resource,count] of Object.entries(report.payload.resources || {}))totals[resource]=(totals[resource] || 0)+count;
  }
  return {totals,sources,staleCount};
}
export function houseReport(agents) {
  return agents.map(a=>({agent:a.id,report:a.reports?.STATUS_UPDATE,house:a.reports?.STATUS_UPDATE?.payload.house}))
    .filter(x=>x.house && Number.isFinite(x.house.placed) && x.house.required>0 && Array.isArray(x.house.cells))
    .sort((a,b)=>b.report.receivedAt-a.report.receivedAt)[0] || null;
}
export function eventCategory(kind) {
  if(['message-accepted','message-sent','message-delivered'].includes(kind))return 'messages';
  if(['link-failed','isolation-enabled','pair-disabled','partitions-changed','agent-disconnected','message-expired','state-rejected'].includes(kind))return 'failures';
  return 'recovery';
}
export function eventText(event) {
  const name=id=>AGENTS.find(a=>a.id===id)?.name || id || 'Agent';
  switch(event.kind) {
    case 'message-delivered':return name(event.from)+' → '+name(event.to)+' · '+pretty(event.type);
    case 'message-sent':return name(event.from)+' → '+name(event.to)+' · sent'+(event.attempt>1?' again ('+event.attempt+')':'');
    case 'message-accepted':return name(event.from)+' published '+pretty(event.type);
    case 'isolation-enabled':return name(event.agentId)+' isolated from peers';
    case 'isolation-disabled':return name(event.agentId)+' isolation removed';
    case 'link-failed':return name(event.a)+' ↔ '+name(event.b)+' · link blocked';
    case 'link-restored':return name(event.a)+' ↔ '+name(event.b)+' · link restored';
    case 'partitions-changed':return 'Network split into '+event.groups.length+' groups';
    case 'partitions-cleared':return 'Network partitions cleared';
    case 'network-restored':return 'All communication faults cleared';
    case 'simulation-reset':return 'New communication run · world and agents preserved';
    case 'agent-connected':return name(event.agentId)+' connected to relay';
    case 'agent-disconnected':return name(event.agentId)+' disconnected from relay';
    case 'state-rejected':return name(event.from)+' · outdated or conflicting state rejected';
    case 'message-expired':return name(event.from)+' → '+name(event.to)+' · message expired';
    default:return pretty(event.kind.replaceAll('-',' '));
  }
}
