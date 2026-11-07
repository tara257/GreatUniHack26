import {useEffect,useRef,useState} from 'react';
import {Activity,Check,Download,Maximize2,Radio,ShieldCheck,Unplug,X} from 'lucide-react';
import {AGENTS,ageText,pretty} from './model.js';
import {PROGRESS_METRICS} from '../../src/progress-evidence.js';

const labels={resourceBlocks:'Resource blocks broken',itemsCrafted:'Items crafted',itemsDeposited:'Items deposited',blocksPlaced:'Blocks placed',discoveries:'New resource sightings'};
const short={resourceBlocks:'broken',itemsCrafted:'crafted',itemsDeposited:'deposited',blocksPlaced:'placed',discoveries:'sightings'};
const name=id=>AGENTS.find(a=>a.id===id)?.title || id;
const clock=ms=>Math.floor(Math.max(0,ms)/60000)+'m '+Math.floor(Math.max(0,ms)%60000/1000)+'s';
const time=at=>new Date(at).toLocaleTimeString('en-GB',{hour12:false});
const work=row=>PROGRESS_METRICS.reduce((sum,key)=>sum+row.totals[key],0);

function EvidenceBody({capture,now,live}) {
  const totals=Object.fromEntries(PROGRESS_METRICS.map(key=>[key,capture.agents.reduce((sum,a)=>sum+a.totals[key],0)]));
  const contributors=capture.agents.filter(a=>work(a)>0);
  const house=capture.house,measured=contributors.length>0,active=!capture.endedAt;
  const spotlight=[...contributors].sort((a,b)=>(b.blockedPeers===b.totalPeers)-(a.blockedPeers===a.totalPeers) || work(b)-work(a))[0];
  const fresh=row=>live && active && row.lastReceivedAt && now-row.lastReceivedAt<=15000;
  return <>
    <div className={'evidence-verdict '+(measured?'measured':'')}><span className="evidence-symbol">{measured?<ShieldCheck size={25}/>:<Activity size={25}/>}</span><div><h3>{measured?'Useful work continued during the outage.':active?'Waiting for measured progress…':'No useful work was recorded in this window.'}</h3><p>{spotlight?name(spotlight.id)+' completed '+PROGRESS_METRICS.filter(key=>spotlight.totals[key]>0).map(key=>spotlight.totals[key]+' '+short[key]).join(', ')+' with '+spotlight.blockedPeers+' of '+spotlight.totalPeers+' peer links blocked.':'Counters only include confirmed operations after the bot receives this outage’s measurement marker. Waiting, walking and failed attempts do not count.'}</p></div></div>
    <div className="evidence-metrics">{PROGRESS_METRICS.map(key=><div key={key}><strong>{totals[key]}</strong><span>{labels[key]}</span></div>)}</div>
    <div className="evidence-house"><span>House observation</span><strong>{house && !house.siteChanged?house.before+' → '+house.after+' / '+house.required+' blocks':'Awaiting comparable, fully loaded surveys'}</strong>{house && !house.siteChanged && <span className={house.after>house.before?'positive':''}>{house.after-house.before>0?'+':''}{house.after-house.before} net blocks</span>}<small>Colony-wide context; the metrics above count affected agents only.{house?' Last survey '+time(house.lastReceivedAt)+'.':''}</small></div>
    <div className="evidence-table-wrap"><table className="evidence-table"><thead><tr><th>Agent</th><th>Peer links blocked</th><th>Confirmed outcomes</th><th>Minecraft report</th></tr></thead><tbody>{capture.agents.map(row=><tr key={row.id}><td><i className={'dot '+(work(row)?'green':'amber')}/>{name(row.id)}</td><td>{row.blockedPeers} / {row.totalPeers}<small>{row.blockedPeers===row.totalPeers?'Fully isolated':'Partially connected'}</small></td><td>{work(row)?PROGRESS_METRICS.filter(key=>row.totals[key]>0).map(key=><span className="evidence-outcome" key={key}>{row.totals[key]} {short[key]}</span>):row.samples?'No outcomes yet':'Awaiting telemetry'}</td><td>{!row.lastReceivedAt?'Unknown':active && !fresh(row)?'Stale / unverified':row.minecraft==='connected'?'In world':pretty(row.minecraft)}<small>{row.lastReceivedAt?(active?ageText(Math.max(0,now-row.lastReceivedAt)):'Last seen '+time(row.lastReceivedAt)):'No report'}{row.interruptions?' · '+row.interruptions+' interruptions':''}</small></td></tr>)}</tbody></table></div>
    <div className="evidence-footnote"><span>{capture.blockedLinks.length} blocked links · {clock((capture.endedAt || now)-capture.startedAt)} · {time(capture.startedAt)}{capture.endedAt?' – '+time(capture.endedAt):' onwards'}</span><span>{capture.agents.some(a=>a.simulated)?'SIMULATED TELEMETRY':'Agent-reported outcomes'} · {active?'Live measurement':'Frozen at '+pretty(capture.endReason)}</span></div>
    {!live && active && <p className="evidence-warning">Observer offline. Measurements shown are the last received reports; progress is currently unverified.</p>}
  </>;
}

export function Evidence({snapshot,now,live,disabled,onControl}) {
  const [selected,setSelected]=useState('latest'),[target,setTarget]=useState(AGENTS[0].id),[presenting,setPresenting]=useState(false);
  const dialog=useRef();
  const captures=snapshot?.evidence?.captures || [],activeId=snapshot?.evidence?.activeId;
  const capture=captures.find(c=>c.id===selected) || captures.at(-1);
  useEffect(()=>{if(presenting)dialog.current?.showModal();else dialog.current?.close();},[presenting,capture?.id]);
  function download() {
    const data={format:'autonomous-colony-outage-evidence-v1',exportedAt:new Date().toISOString(),serverId:snapshot.serverId,runId:snapshot.runId,
      measurement:'Agent-reported successful operations carrying the same relay-issued outage window. Operations spanning window changes and reports arriving after restoration are excluded. Counts can under-report. Shared Minecraft world remains available.',capture};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='colony-outage-'+capture.id.slice(0,8)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="panel evidence-panel" id="evidence"><div className="panel-heading"><div><span className="eyebrow">RESILIENCE · LIVE PROOF</span><h2>Progress while links are blocked.</h2></div><span className={'evidence-state '+(activeId?'recording':'')}>{activeId?<Activity size={13}/>:<Check size={13}/>} {activeId?'MEASURING':capture?'SAVED RESULT':'READY TO DEMONSTRATE'}</span></div>
    <div className="evidence-toolbar"><p>{capture?'Every isolate or partition records automatically. Restore links to freeze the result.':'Start the bots, then isolate an agent. This panel will record useful work without directing any bot.'}</p><div className="evidence-actions">{activeId?<button className="button restore-network" disabled={disabled} onClick={()=>onControl('heal',{},'Links restored. Outage evidence saved.')}><Radio size={14}/>Restore & save result</button>:<><select aria-label="Agent for outage demonstration" value={target} onChange={e=>setTarget(e.target.value)}>{AGENTS.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select><button className="button fault-button" disabled={disabled || !snapshot?.agents.some(a=>a.id===target)} onClick={()=>{setSelected('latest');onControl('isolation',{agentId:target,isolated:true},'Outage started. Evidence records automatically.');}}><Unplug size={14}/>Start outage demo</button></>}</div></div>
    {capture && <><div className="evidence-picker"><label>Evidence window <select aria-label="Evidence window" value={captures.some(c=>c.id===selected)?selected:'latest'} onChange={e=>setSelected(e.target.value)}><option value="latest">Latest window {activeId?'· live':''}</option>{[...captures].reverse().map(c=><option key={c.id} value={c.id}>{time(c.startedAt)} · {c.blockedLinks.length} blocked links{c.endedAt?' · saved':' · live'}</option>)}</select></label><div><button className="small-button" onClick={download}><Download size={13}/>Download evidence</button><button className="small-button" onClick={()=>setPresenting(true)}><Maximize2 size={13}/>Present evidence</button></div></div><EvidenceBody capture={capture} now={now} live={live}/></>}
    <footer className="panel-note">{capture?'Keeps the latest 8 windows until relay restart or Reset simulation. Download a result to keep it.':'No historical progress is backfilled. The dashboard never fabricates progress or uses inventory gains as proof of gathering.'}</footer>
    {capture && <dialog ref={dialog} className="evidence-presentation" aria-labelledby="evidence-title" onCancel={e=>{e.preventDefault();setPresenting(false);}}><div className="dialog-heading"><div><span className="eyebrow">COLONY · OUTAGE EVIDENCE</span><h2 id="evidence-title">The network failed. What kept working?</h2></div><button className="icon-button" aria-label="Close evidence presentation" onClick={()=>setPresenting(false)}><X size={20}/></button></div><EvidenceBody capture={capture} now={now} live={live}/><p className="evidence-disclosure">Peer messaging was interrupted. Minecraft, local observations and shared chests remained available. No central controller chose the agents’ actions.</p><div className="dialog-actions"><button className="button secondary" onClick={download}><Download size={14}/>Download evidence</button><button className="button secondary" onClick={()=>setPresenting(false)}>Back to dashboard</button></div></dialog>}
  </section>;
}
