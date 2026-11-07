// Operator-only CLI. This never sends instructions to a Minecraft bot.
import { loadOperatorToken } from '../src/comms/operator-credentials.js';
const [command,...args]=process.argv.slice(2);
const url=process.env.COMMS_HTTP_URL || 'http://127.0.0.1:8090';
const token=process.env.COMMS_OPERATOR_TOKEN || loadOperatorToken(url);
const usage='Usage: npm run comms:control -- status | isolate ID | restore ID | partition A,B C,D E | link A B on/off | heal';
let path,body;
if(command==='status' && !args.length)path='/api/state';
else if(['isolate','restore'].includes(command) && args.length===1) {
  path='/api/isolation';body={agentId:args[0],isolated:command==='isolate'};
} else if(command==='partition' && args.length>=2) {
  path='/api/partitions';body={groups:args.map(group=>group.split(','))};
} else if(command==='link' && args.length===3 && ['on','off'].includes(args[2])) {
  path='/api/links';body={a:args[0],b:args[1],enabled:args[2]==='on'};
} else if(command==='heal' && !args.length) {path='/api/heal';body={};}
else {console.error(usage);process.exit(1);}
if(!token){console.error('Start npm run comms:server locally, or set COMMS_OPERATOR_TOKEN to its operator token.');process.exit(1);}
try {
  const response=await fetch(url+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(5000),
    headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw new Error(`${response.status}: ${JSON.stringify(result)}`);
  console.table(result.agents.map(a=>({agent:a.id,relay:a.connection.state,isolated:a.communication.isolated,
    partition:a.communication.partition,reportedMinecraft:a.minecraft.value,reportStale:a.minecraft.stale,pending:a.pendingMessages})));
  console.table(result.links.map(l=>({a:l.a,b:l.b,canCommunicate:l.canCommunicate,
    socketsConnected:l.transportAvailable,blockedBy:l.blockedBy.join(', ')})));
} catch(error) {console.error(`Control failed: ${error.message}`);process.exitCode=1;}
