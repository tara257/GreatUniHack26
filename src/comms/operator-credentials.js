// Local operator convenience only. Gameplay agents never import this module.
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const local=host=>['127.0.0.1','localhost','::1','[::1]'].includes(host);
const tokenPath=port=>fileURLToPath(new URL(`../../.state/comms-operator-${port}.token`,import.meta.url));
export function saveOperatorToken(url,token) {
  const address=new URL(url);if(!local(address.hostname))return null;
  const file=tokenPath(address.port);mkdirSync(dirname(file),{recursive:true});
  writeFileSync(file,token+'\n',{mode:0o600});chmodSync(file,0o600);return file;
}
export function loadOperatorToken(url) {
  const address=new URL(url);if(!local(address.hostname))return '';
  try{return readFileSync(tokenPath(address.port),'utf8').trim();}catch{return '';}
}
