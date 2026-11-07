import { createRelay } from '../src/comms/relay.js';

const port=Number(process.env.COMMS_PORT || 8090);
if(!Number.isInteger(port) || port<1 || port>65535)throw new Error('COMMS_PORT must be 1–65535');
const relay=createRelay({port,host:process.env.COMMS_HOST || '127.0.0.1',
  agentToken:process.env.COMMS_AGENT_TOKEN || '',
  ...(process.env.COMMS_OPERATOR_TOKEN?{operatorToken:process.env.COMMS_OPERATOR_TOKEN}:{})});
const urls=await relay.listen();
console.log('Autonomous Colony communication relay');
console.log(`Agent endpoint: ${urls.wsUrl}`);
console.log(`Operator API: ${urls.httpUrl}/api/state`);
console.log(`Observer endpoint: ${urls.observerUrl}`);
console.log(`Operator token: ${relay.operatorToken}`);
console.log('The operator token is for dashboard/fault controls only; do not give it to agents.');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await relay.close();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
