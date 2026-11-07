import {useEffect,useState} from 'react';
import {Check,Pause,Play,Users} from 'lucide-react';
import {AGENTS} from './model.js';
import {PixelIcon} from './PixelArt.jsx';

export function Roster({getRoster,command,live,pending}) {
  const [state,setState]=useState(null),[error,setError]=useState(''),[draft,setDraft]=useState([]),[dirty,setDirty]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{
    if(!live)return;let cancelled=false;
    async function refresh(){try{const next=await getRoster();if(!cancelled){setState(next);setError('');}}catch(e){if(!cancelled){setState(null);setError(e.message);}}}
    refresh();const timer=setInterval(refresh,3000);return()=>{cancelled=true;clearInterval(timer);};
  },[getRoster,live]);
  useEffect(()=>{if(state && !dirty)setDraft(state.roles.filter(a=>a.selected).map(a=>a.role));},[state,dirty]);
  async function act(action){setNotice('');try{const next=await command('roster',action==='roles'?{action,roles:draft}:{action});setState(next);if(action==='roles')setDirty(false);setNotice(action==='roles'?'Roster applied. New agents join and start their own work.':action==='start'?'Start command sent to the selected bots.':'Pause command sent to the selected bots.');}catch(e){setNotice(e.message);}}
  const disabled=!live || !state || pending;
  return <section className="panel roster-panel" aria-label="Choose Minecraft agents"><div className="roster-heading"><div><span className="eyebrow">YOUR COLONY</span><h2><Users size={18}/>Choose who joins Minecraft.</h2></div><span>{state?state.roles.filter(a=>a.selected).length+' roles selected':'Launcher unavailable'}</span></div>
    <div className="roster-options">{AGENTS.map(meta=>{const role=state?.roles.find(a=>a.role===meta.role);return <label key={meta.role} className={draft.includes(meta.role)?'chosen':''}><input type="checkbox" aria-label={'Include '+meta.title} checked={draft.includes(meta.role)} disabled={disabled} onChange={e=>{setDirty(true);setDraft(e.target.checked?[...draft,meta.role]:draft.filter(r=>r!==meta.role));}}/><PixelIcon name={meta.role} size={25}/><span><b>{meta.title}</b><small>{role?.processRunning?'Process running':role?.selected?'Process stopped':'Not selected'}</small></span><i style={{background:meta.color}}/></label>;})}</div>
    <div className="roster-footer"><p>{error || 'Removing a role disconnects that bot from Minecraft and saves its memory. Communication isolation keeps the bot playing.'}</p><div><button className="button secondary" disabled={disabled || dirty} onClick={()=>act('pause')}><Pause size={13}/>Pause work</button><button className="button restore-network" disabled={disabled || dirty} onClick={()=>act('start')}><Play size={13}/>Start work</button><button className="button fault-button" disabled={disabled || !dirty} onClick={()=>act('roles')}><Check size={13}/>{pending?'Applying…':draft.length?'Apply roster':'Remove all agents'}</button></div></div>{notice && <p className="roster-notice" role="status">{notice}</p>}
  </section>;
}
