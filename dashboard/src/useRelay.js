import {useCallback,useEffect,useRef,useState} from 'react';

export function useRelay() {
  const [snapshot,setSnapshot]=useState(null),[status,setStatus]=useState('connecting'),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const [manualToken,setManualToken]=useState(null),[retry,setRetry]=useState(0),[clock,setClock]=useState(Date.now());
  const credential=useRef(''),receivedAt=useRef(Date.now()),current=useRef(null);
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),1000);return ()=>clearInterval(t);},[]);
  useEffect(()=>{
    let cancelled=false,socket,timer,attempt=0;
    async function connect() {
      setStatus('connecting');
      try {
        let token=manualToken;
        if(!token) {
          const response=await fetch('/dashboard/session',{method:'POST',headers:{'X-Colony-Dashboard':'1'},signal:AbortSignal.timeout(5000)});
          if(!response.ok){if(!cancelled){setStatus('auth');setError('Enter the relay operator token to connect.');}return;}
          token=(await response.json()).token;
        }
        if(cancelled)return;
        credential.current=token;
        socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/observe');
        socket.onopen=()=>socket.send(JSON.stringify({v:1,kind:'SUBSCRIBE',token}));
        socket.onmessage=event=>{
          let message;try{message=JSON.parse(event.data);}catch{return;}
          if(message.kind==='ERROR'){setError(message.message);if(message.code==='UNAUTHORIZED')setStatus('auth');return;}
          if(message.kind!=='SNAPSHOT')return;
          const next=message.state,previous=current.current;
          if(previous && previous.serverId===next.serverId && next.revision<previous.revision)return;
          current.current=next;receivedAt.current=Date.now();setSnapshot(next);setClock(Date.now());setStatus('live');setError('');attempt=0;
        };
        socket.onclose=event=>{
          if(cancelled)return;
          if(event.code===1008){setStatus('auth');setError('Operator token rejected. Enter the current token.');return;}
          setStatus('offline');timer=setTimeout(connect,Math.min(5000,500*2**attempt++));
        };
        socket.onerror=()=>socket.close();
      } catch(e) {
        if(cancelled)return;
        setStatus('offline');setError('Relay unavailable. Reconnecting automatically.');timer=setTimeout(connect,3000);
      }
    }
    connect();return ()=>{cancelled=true;clearTimeout(timer);socket?.close();};
  },[manualToken,retry]);
  const command=useCallback(async(path,body)=>{
    if(status!=='live')throw new Error('Wait for the relay connection before changing links.');
    setPending(true);
    try {
      const response=await fetch('/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+credential.current,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.message || result.error || 'Control failed');
      const previous=current.current;
      if(result.serverId && (!previous || previous.serverId!==result.serverId || result.revision>=previous.revision)){current.current=result;receivedAt.current=Date.now();setSnapshot(result);setClock(Date.now());}
      return result;
    } finally {setPending(false);}
  },[status]);
  const connectWithToken=token=>{setManualToken(token);setRetry(r=>r+1);};
  const getRoster=useCallback(async()=>{
    if(status!=='live')throw new Error('Relay offline');
    const response=await fetch('/api/roster',{headers:{Authorization:'Bearer '+credential.current},signal:AbortSignal.timeout(5000)});
    const result=await response.json();if(!response.ok)throw new Error(result.message || 'Bot launcher unavailable');return result;
  },[status]);
  return {snapshot,status,error,pending,command,connectWithToken,getRoster,now:snapshot?snapshot.at+clock-receivedAt.current:clock};
}
