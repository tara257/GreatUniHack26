import {useEffect,useRef,useState} from 'react';
import {Box,Pickaxe,Trees,Hammer,Anvil,Compass,Network,Radio,Unplug,RotateCcw,GitBranch,ShieldCheck,ArrowUpRight,Activity,Package,Clock3,Maximize2,Minimize2,Settings2,X,Pause,Play,Search,ChevronDown,Check,TriangleAlert,LoaderCircle,Heart,House} from 'lucide-react';
import {AGENTS,age,ageText,communication,eventCategory,eventText,houseReport,inventories,pretty,stale} from './model.js';
import {useRelay} from './useRelay.js';
const icons={miner:Pickaxe,lumberjack:Trees,builder:Hammer,crafter:Anvil,scout:Compass};
const formatNumber=value=>new Intl.NumberFormat().format(value ?? 0);

function Badge({tone='muted',children}) {return <span className={'badge '+tone}><i/>{children}</span>;}
function Modal({title,onClose,children}) {
  const ref=useRef();useEffect(()=>{ref.current.showModal();return ()=>ref.current?.close();},[]);
  return <dialog ref={ref} onCancel={e=>{e.preventDefault();onClose();}} aria-labelledby="dialog-title" onClick={e=>{if(e.target===ref.current)onClose();}}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19}/></button></div>{children}
  </dialog>;
}
function AgentCard({meta,agent,now,online,disabled,onIsolate,selected}) {
  const Icon=icons[meta.role],report=agent?.reports.STATUS_UPDATE,inventory=agent?.reports.RESOURCE_UPDATE;
  const comm=communication(agent),old=stale(report,now),mc=agent?.minecraft;
  const mcOld=!online || stale(mc,now),items=Object.entries(inventory?.payload.resources || {}).sort((a,b)=>b[1]-a[1]);
  return <article id={'agent-'+meta.role} className={'agent-card '+(agent?.communication.isolated?'isolated ':'')+(selected?'selected':'')} style={{'--role-color':meta.color}}>
    <header className="agent-heading"><span className="role-icon"><Icon size={21} strokeWidth={1.7}/></span><div><h3>{meta.title}</h3><span className="agent-name">{meta.id}</span></div><span className="agent-number">0{AGENTS.indexOf(meta)+1}</span></header>
    <div className="agent-status"><span>Minecraft</span><Badge tone={!mcOld && mc?.value==='connected'?'good':mcOld?'muted':'danger'}>{mcOld?'Unknown / stale':mc.value==='connected'?'In world':'Disconnected'}</Badge></div>
    <div className="agent-status"><span>Peer links</span><Badge tone={online?comm.tone:'muted'}>{online?comm.label:'Unverified'}</Badge></div>
    <div className="task"><span className="eyebrow">CURRENT TASK {old && report && <em>STALE</em>}</span><p title={report?.payload.task}>{report?.payload.task || 'Waiting for the first agent report…'}</p></div>
    <div className="card-inventory"><div className="small-label"><Package size={12}/><span>Carrying {stale(inventory,now) && inventory?'· stale':''}</span><span className="health" title="Last reported health"><Heart size={11}/>{report?.payload.health ?? '—'}</span></div>
      {!inventory?<span className="empty-inline">Inventory not reported</span>:items.length===0?<span className="empty-inline">Empty inventory</span>:<details><summary><span className="item-tags">{items.slice(0,2).map(([item,count])=><span key={item} title={pretty(item)}>{pretty(item)} <b>{count}</b></span>)}</span>{items.length>2 && <span className="more-items">+{items.length-2}<ChevronDown size={12}/></span>}</summary><div className="expanded-inventory">{items.map(([item,count])=><div key={item}><span>{pretty(item)}</span><b>{count}</b></div>)}</div></details>}
    </div>
    <footer><span className={old?'last-update stale':'last-update'} title={report?new Date(report.receivedAt).toLocaleString():'No observation yet'}><Clock3 size={11}/>{ageText(age(report,now))}</span><button className={'isolate-button '+(agent?.communication.isolated?'restore':'')} disabled={disabled || !agent} onClick={()=>onIsolate(meta.id,!agent.communication.isolated)} aria-label={(agent?.communication.isolated?'Restore ':'Isolate ')+meta.title}>{agent?.communication.isolated?<Radio size={13}/>:<Unplug size={13}/>} {agent?.communication.isolated?'Restore':'Isolate'}</button></footer>
  </article>;
}
const positions=[[160,82],[410,82],[484,228],[285,268],[94,228]];
function NetworkGraph({agents,links,events,selected,onSelect,now,verified}) {
  const pair=Object.fromEntries(links.map(l=>[[l.a,l.b].sort().join('|'),l]));
  return <svg className="network-graph" viewBox="0 0 580 334" role="img" aria-label="Agent communication network. Green lines are available links; dashed amber lines are blocked.">
    <defs><pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#283236"/></pattern><radialGradient id="glow"><stop stopColor="#437764" stopOpacity=".13"/><stop offset="1" stopColor="#10171b" stopOpacity="0"/></radialGradient></defs>
    <rect width="580" height="334" fill="url(#grid)"/><ellipse cx="290" cy="165" rx="245" ry="155" fill="url(#glow)"/>
    {AGENTS.flatMap((a,i)=>AGENTS.slice(i+1).map((b,j)=>{
      const link=pair[[a.id,b.id].sort().join('|')],active=verified && !!link?.canCommunicate,blocked=verified && link && !link.policyAllowed;
      const [x1,y1]=positions[i],[x2,y2]=positions[i+j+1],path='M '+x1+' '+y1+' L '+x2+' '+y2;
      const traffic=active && events.some(e=>e.kind==='message-sent' && now-e.at<2000 && ((e.from===a.id && e.to===b.id)||(e.from===b.id && e.to===a.id)));
      return <g key={a.id+b.id} opacity={!selected || [a.id,b.id].includes(selected)?1:.22}><path d={path} className={'network-edge '+(active?'active':blocked?'blocked':'unavailable')}><title>{a.name+' ↔ '+b.name+': '+(!verified?'unknown while observer is offline':active?'available':blocked?link.blockedBy.join(', '):'transport unavailable')}</title></path>{traffic && <circle className="packet" r="2.5" fill="#9dd3ad"><animateMotion dur="2s" repeatCount="indefinite" path={path}/></circle>}</g>;
    }))}
    <text x="287" y="156" textAnchor="middle" className="network-center">SHARED GOAL</text><text x="287" y="175" textAnchor="middle" className="network-goal">Independent decisions</text>
    {AGENTS.map((meta,i)=>{
      const a=agents.find(a=>a.id===meta.id),[x,y]=positions[i],Icon=icons[meta.role],isolated=a?.communication.isolated;
      return <g key={meta.id} transform={'translate('+x+' '+y+')'} className={'network-node '+(isolated?'is-isolated':'')} role="button" tabIndex="0" aria-label={'Highlight '+meta.title} onClick={()=>onSelect(selected===meta.id?null:meta.id)} onKeyDown={e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();onSelect(selected===meta.id?null:meta.id);}}}>
        <circle r="32" className="node-ring" style={{stroke:selected===meta.id?meta.color:undefined}}/><circle r="26" fill="#172126" stroke={isolated?'#d89b51':'#354047'}/><g transform="translate(-10 -10)" color={meta.color}><Icon size={20} strokeWidth={1.6}/></g>
        <circle cx="20" cy="-20" r="4" fill={!verified || !a || a.connection.state!=='connected'?'#69727c':isolated?'#efb468':'#8fd0a4'} stroke="#11171c" strokeWidth="3"/>
        <text y="49" textAnchor="middle" className="node-name">{meta.name}</text><text y="63" textAnchor="middle" className="node-role">{meta.title}{a?.communication.partition!=null?' · '+communication(a).label:''}</text>
      </g>;
    })}
  </svg>;
}
function HouseModel({house}) {
  const cells=[...(house?.cells || [])].sort((a,b)=>a.y-b.y || a.x+a.z-b.x-b.z);
  return <svg viewBox="0 0 240 200" className="house-model" role="img" aria-label={house?'Blueprint blocks: solid blocks are observed in place; outlines are missing or unobserved.':'Awaiting builder survey'}>
    <defs><pattern id="house-grid" width="20" height="10" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .5 -1 .5 120 95)"><path d="M 20 0 H 0 V 10" fill="none" stroke="#343a37" strokeWidth=".6"/></pattern></defs>
    <path d="M 120 75 235 132 120 190 5 132 Z" fill="url(#house-grid)"/>
    {cells.map(c=>{
      const x=120+(c.x-c.z)*18,y=91+(c.x+c.z)*9-c.y*23,complete=c.status==='complete';
      const top=x+','+y+' '+(x+18)+','+(y+9)+' '+x+','+(y+18)+' '+(x-18)+','+(y+9);
      const left=(x-18)+','+(y+9)+' '+x+','+(y+18)+' '+x+','+(y+40)+' '+(x-18)+','+(y+31);
      const right=x+','+(y+18)+' '+(x+18)+','+(y+9)+' '+(x+18)+','+(y+31)+' '+x+','+(y+40);
      return <g key={[c.x,c.y,c.z].join(',')} stroke={complete?'#c7a46a':'#515952'} strokeWidth=".65" opacity={complete?1:.24}><polygon points={left} fill={complete?'#665b43':'#171d1b'}/><polygon points={right} fill={complete?'#89764f':'#171d1b'}/><polygon points={top} fill={complete?'#d7b97a':'#202821'}/></g>;
    })}
    {!house && <text x="120" y="110" textAnchor="middle" fill="#788078" fontSize="12">No site observation yet</text>}
  </svg>;
}
function Construction({data,now,online}) {
  const house=data?.house,old=data && (!online || stale(data.report,now));
  return <section className="panel construction" id="construction"><div className="panel-heading"><div><span className="eyebrow">THE SHARED OBJECTIVE</span><h2>Build a place to call home.</h2></div><House size={19} className="subtle"/></div>
    <div className="house-overview"><HouseModel house={house}/><div className="house-progress"><span className="blueprint-label">STARTER HOUSE</span><div className="big-percent">{house?house.percent:'—'}<span>%</span></div><span className="placed-count">{house?house.placed+' / '+house.required+' blocks placed':'Awaiting builder telemetry'}</span><Badge tone={!house || old?'muted':house.percent===100?'good':'warning'}>{!house?'No survey':old?'Stale survey':house.unknown?'Partial observation':house.percent===100?'Complete':'In progress'}</Badge></div></div>
    <div className="construction-phases">{(house?.phases || [{name:'Foundation'},{name:'Walls & windows'},{name:'Roof'}]).map((phase,i)=><div className="phase" key={phase.name}><span className={'phase-number '+(phase.placed===phase.required && phase.required?'done':'')}>{phase.placed===phase.required && phase.required?<Check size={12}/>:i+1}</span><div><div className="phase-label"><span>{phase.name}</span><span>{phase.required?phase.placed+' / '+phase.required:'—'}</span></div><div className="track"><span style={{width:(phase.required?100*phase.placed/phase.required:0)+'%'}}/></div></div></div>)}</div>
    <footer className="panel-note"><span className="dot amber"/> {house?'Observed by '+(AGENTS.find(a=>a.id===data.agent)?.name || data.agent)+' · '+ageText(age(data.report,now)):'Progress comes from observed Minecraft blocks.'}{house?.unknown>0?' · '+house.unknown+' blocks unobserved':''}</footer>
  </section>;
}
function Resources({agents,now}) {
  const inventory=inventories(agents,now),items=Object.entries(inventory.totals).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
  const [query,setQuery]=useState('');
  return <section className="panel resources" id="resources"><div className="panel-heading"><div><span className="eyebrow">COLONY RESOURCES</span><h2>Every contribution counts.</h2></div><Package size={20} className="subtle"/></div><p className="panel-description">Carried inventory from {inventory.sources.length} fresh agent reports. Shared chests are not included.</p>
    <label className="search"><Search size={14}/><input aria-label="Filter resources" placeholder="Find a resource…" value={query} onChange={e=>setQuery(e.target.value)}/>{query && <button onClick={()=>setQuery('')} aria-label="Clear resource filter"><X size={13}/></button>}</label>
    <div className="resource-list">{items.filter(([name])=>pretty(name).toLowerCase().includes(query.toLowerCase())).map(([name,count])=><div className="resource-row" key={name}><span className="resource-cube"><Box size={18}/></span><span>{pretty(name)}</span><strong>{formatNumber(count)}</strong><span className="unit">items</span></div>)}{!items.length && <div className="empty-state"><Package size={25}/><p>{inventory.sources.length?'Reported inventories are empty.':'Waiting for fresh inventory reports.'}</p></div>}{items.length>0 && !items.some(([name])=>pretty(name).toLowerCase().includes(query.toLowerCase())) && <p className="empty-state">No matching resources.</p>}</div>
    <footer className="panel-note"><span className="dot green"/>{items.length} resource types · {inventory.staleCount?inventory.staleCount+' stale reports excluded':'Fresh observations only'}</footer>
  </section>;
}
function EventLog({events,live}) {
  const [filter,setFilter]=useState('all'),[paused,setPaused]=useState(false),[frozen,setFrozen]=useState([]);
  const shown=(paused?frozen:events).filter(e=>filter==='all' || eventCategory(e.kind)===filter).slice(-100).reverse();
  return <section className="panel event-panel" id="events"><div className="panel-heading"><div><span className="eyebrow">LIVE EVENT STREAM</span><h2>The colony, in motion.</h2></div><button className="small-button" onClick={()=>{if(!paused)setFrozen([...events]);setPaused(!paused);}} aria-label={paused?'Resume event log':'Pause event log'}>{paused?<Play size={13}/>:<Pause size={13}/>} {paused?'Resume':'Pause'}</button></div>
    <div className="log-toolbar"><div className="tabs" role="group" aria-label="Event filters">{['all','messages','failures','recovery'].map(f=><button key={f} aria-pressed={filter===f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{pretty(f)}</button>)}</div><span className="log-state"><i className={'dot '+(paused?'amber':'green')}/>{paused?'View paused':live?'Streaming':'Relay offline'}</span></div>
    <div className="event-list" tabIndex="0" aria-label="Recent relay events">{shown.map(e=><div className={'event-row '+eventCategory(e.kind)} key={e.serverId+':'+e.revision}><time>{new Date(e.at).toLocaleTimeString('en-GB',{hour12:false})}</time><span className="event-symbol">{eventCategory(e.kind)==='failures'?<Unplug size={13}/>:eventCategory(e.kind)==='messages'?<ArrowUpRight size={13}/>:<Radio size={13}/>}</span><span title={eventText(e)}>{eventText(e)}</span><span className="event-kind">{e.kind==='message-delivered'?'DELIVERED':e.kind.startsWith('message-')?e.kind.slice(8).toUpperCase():eventCategory(e.kind).toUpperCase()}</span></div>)}{!shown.length && <div className="empty-state"><Activity size={25}/><p>No {filter==='all'?'':filter+' '}events yet.</p></div>}</div>
  </section>;
}
export default function App() {
  const relay=useRelay(),{snapshot,status,now,pending,command}=relay;
  const [modal,setModal]=useState(null),[toast,setToast]=useState(null),[selected,setSelected]=useState(null),[full,setFull]=useState(false),[token,setToken]=useState('');
  const [groups,setGroups]=useState(Object.fromEntries(AGENTS.map((a,i)=>[a.id,i<2?'A':'B'])));
  const [history,setHistory]=useState({run:null,events:[]});
  useEffect(()=>{
    if(!snapshot)return;
    const run=snapshot.serverId+':'+snapshot.runId;
    setHistory(previous=>{
      if(previous.run!==run)return {run,events:snapshot.recentEvents};
      const seen=new Set(previous.events.map(e=>e.serverId+':'+e.revision));
      return {run,events:[...previous.events,...snapshot.recentEvents.filter(e=>!seen.has(e.serverId+':'+e.revision))].slice(-2000)};
    });
  },[snapshot]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(null),6000);return ()=>clearTimeout(t);},[toast]);
  useEffect(()=>{const change=()=>setFull(!!document.fullscreenElement);document.addEventListener('fullscreenchange',change);return ()=>document.removeEventListener('fullscreenchange',change);},[]);
  const agents=(snapshot?.agents || []).filter(a=>AGENTS.some(meta=>meta.id===a.id)),links=(snapshot?.links || []).filter(l=>AGENTS.some(a=>a.id===l.a) && AGENTS.some(a=>a.id===l.b));
  const active=links.filter(l=>l.canCommunicate).length,blocked=links.filter(l=>!l.policyAllowed).length;
  const gameOnline=agents.filter(a=>a.minecraft.value==='connected' && !stale(a.minecraft,now)).length;
  const isolated=agents.filter(a=>a.communication.isolated).length,live=status==='live',disabled=!live || pending;
  const construction=houseReport(agents),simulated=agents.some(a=>a.reports.STATUS_UPDATE?.payload.details?.simulated===true);
  async function act(path,body,message,close=false) {
    try {await command(path,body);setToast({text:message});if(close)setModal(null);}catch(error){setToast({text:error.message,error:true});}
  }
  const runAge=snapshot?Math.max(0,Math.floor((now-snapshot.runStartedAt)/1000)):0;
  const duration=Math.floor(runAge/3600).toString().padStart(2,'0')+':'+Math.floor(runAge%3600/60).toString().padStart(2,'0')+':'+(runAge%60).toString().padStart(2,'0');
  return <><div className="ambient"/><header className="topbar"><a className="brand" href="#overview"><span className="brand-mark"><Box size={25}/></span><span>AUTONOMOUS<strong>COLONY<span className="brand-dot">.</span></strong></span></a><nav><a href="#overview" className="active">Overview</a><a href="#network">Network</a><a href="#events">Event log</a></nav><div className="topbar-right"><span className={'live-pill '+(live?'':'offline')}><i/>{live?(simulated?'SIMULATED AGENTS':gameOnline?'LIVE MINECRAFT':'RELAY ONLINE'):status==='connecting'?'CONNECTING':'RELAY OFFLINE'}</span><button className="icon-button" aria-label="Connection settings" onClick={()=>setModal('connection')}><Settings2 size={18}/></button><button className="icon-button" aria-label={full?'Exit presentation mode':'Enter presentation mode'} onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setToast({text:'Full-screen is unavailable in this browser. Use the window controls.',error:true});}}}>{full?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button></div></header>
    <main id="overview"><div className="overview-heading"><div><div className="eyebrow"><span className="tiny-square"/> MISSION CONTROL <span className="heading-separator">/</span> AUTONOMOUS SYSTEMS</div><h1>One colony. Five minds.</h1><p>A shared goal. Independent decisions. Built to keep going.</p></div><div className="heading-actions"><button className="button secondary" disabled={disabled} onClick={()=>setModal('reset')}><RotateCcw size={15}/>Reset simulation</button><button className="button restore-network" disabled={disabled} onClick={()=>act('heal',{},'All communication faults cleared.')}><Radio size={15}/>Restore network</button></div></div>
    {!live && <div className="connection-banner" role="status"><LoaderCircle size={16} className={status==='connecting'?'spin':''}/><span>{status==='auth'?'Operator connection required.':relay.error || 'Connecting to the communication relay…'} Previous reports may be stale; controls are disabled.</span><button onClick={()=>setModal('connection')}>Connection settings <ArrowUpRight size={14}/></button></div>}
    <div className={'mission-strip '+(blocked?'fault-active':'')}><span className="mission-state">{blocked?<TriangleAlert size={16}/>:<ShieldCheck size={16}/>}<b>{!live?'AWAITING CONNECTION':blocked?'COMMUNICATION FAULT ACTIVE':active===10?'COLONY CONNECTED':'WAITING FOR AGENTS'}</b><span>{blocked?isolated+' isolated · '+blocked+' blocked links':'Agents make their own decisions'}</span></span><div className="strip-stats"><span><i className="dot green"/>{live?gameOnline:'—'}<small>/ 5 in Minecraft</small></span><span><Network size={13}/>{live?active:'—'}<small>/ 10 links</small></span><span className="run-clock"><Clock3 size={13}/>{snapshot?duration:'—'}<small>run time</small></span></div></div>
    <section className="agents-grid" aria-label="Five colony agents">{AGENTS.map(meta=><AgentCard key={meta.id} meta={meta} agent={agents.find(a=>a.id===meta.id)} now={now} online={live} disabled={disabled} selected={selected===meta.id} onIsolate={(agentId,isolated)=>act('isolation',{agentId,isolated},(AGENTS.find(a=>a.id===agentId)?.name || agentId)+(isolated?' isolated. Minecraft work continues.':' isolation removed. Other fault layers may still apply.'))}/>)}</section>
    <div className="primary-grid"><section className="panel network-panel" id="network"><div className="panel-heading"><div><span className="eyebrow">COMMUNICATION TOPOLOGY</span><h2>Five agents. Every link visible.</h2></div><span className="link-count"><b>{live?active:'—'}</b> / 10 LINKS</span></div><NetworkGraph agents={agents} links={links} events={snapshot?.recentEvents || []} selected={selected} onSelect={setSelected} now={now} verified={live}/><div className="network-bottom"><div className="legend"><span><i className="legend-line green"/>Available</span><span><i className="legend-line amber"/>Blocked</span><span><i className="legend-line gray"/>Offline / unknown</span></div><button className="button fault-button" disabled={disabled || agents.length<2} onClick={()=>setModal('partition')}><GitBranch size={15}/>Create partition</button></div></section><Construction data={construction} now={now} online={live}/></div>
    <div className="secondary-grid"><Resources agents={live?agents:[]} now={now}/><EventLog key={history.run} events={history.events} live={live}/></div>
    <footer className="page-footer"><span><Box size={13}/>AUTONOMOUS COLONY <i/> GREATUNIHACK 26</span><span>Observed state, not shared truth. <span className="dot green"/> {snapshot?formatNumber(snapshot.counters.delivered)+' deliveries this run':'Awaiting relay'}</span></footer>
    </main>
    {toast && <div className={'toast '+(toast.error?'error':'')} role="status">{toast.error?<TriangleAlert size={17}/>:<Check size={17}/>}<span>{toast.text}</span><button aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={15}/></button></div>}
    {modal==='partition' && <Modal title="Divide the network" onClose={()=>!pending && setModal(null)}><p className="dialog-description">Agents in the same group can exchange messages. Different groups cannot. Their Minecraft work continues.</p><div className="partition-assignment">{AGENTS.map(a=><label key={a.id}><span className="assignment-dot" style={{background:a.color}}/><span><b>{a.title}</b><small>{a.name}</small></span><select aria-label={a.title+' partition group'} value={groups[a.id]} disabled={!agents.some(agent=>agent.id===a.id)} onChange={e=>setGroups({...groups,[a.id]:e.target.value})}>{['A','B','C'].map(g=><option key={g} value={g}>Group {g}</option>)}</select></label>)}</div><p className="dialog-note"><TriangleAlert size={14}/>Existing isolation and disabled pairs stay in effect.</p><div className="dialog-actions"><button className="button secondary" onClick={()=>setModal(null)} disabled={pending}>Cancel</button><button className="button fault-button" disabled={disabled || new Set(agents.map(a=>groups[a.id])).size<2} onClick={()=>act('partitions',{groups:['A','B','C'].map(g=>agents.filter(a=>groups[a.id]===g).map(a=>a.id)).filter(g=>g.length)},'Network partition applied.',true)}><GitBranch size={15}/>{pending?'Applying…':'Apply partition'}</button></div></Modal>}
    {modal==='reset' && <Modal title="Start a fresh communication run?" onClose={()=>!pending && setModal(null)}><p className="dialog-description">Restore all peer links and clear the run counters and recent event history.</p><div className="reset-note"><ShieldCheck size={23}/><div><b>The colony keeps its progress.</b><p>Minecraft, inventories, built blocks, agent knowledge and queued messages are preserved. This resets the communication experiment.</p></div></div><div className="dialog-actions"><button className="button secondary" disabled={pending} onClick={()=>setModal(null)}>Keep this run</button><button className="button fault-button" disabled={disabled} onClick={()=>act('reset',{},'New run started. Links restored; colony progress preserved.',true)}><RotateCcw size={15}/>{pending?'Resetting…':'Reset communication run'}</button></div></Modal>}
    {modal==='connection' && <Modal title="Relay connection" onClose={()=>setModal(null)}><p className="dialog-description">The dashboard reads the live observer stream at this server. Local connections authenticate automatically.</p><div className="connection-detail"><span>Server</span><code>{location.host}</code><span>Status</span><Badge tone={live?'good':'warning'}>{status}</Badge></div><label className="token-label">Operator token <span>For manual or remote authentication</span><input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder="Paste the token from the relay terminal"/></label><div className="dialog-actions"><button className="button secondary" onClick={()=>{relay.connectWithToken(null);setModal(null);}}>Retry local connection</button><button className="button restore-network" disabled={!token.trim()} onClick={()=>{relay.connectWithToken(token.trim());setToken('');setModal(null);}}>Connect</button></div></Modal>}
  </>;
}
