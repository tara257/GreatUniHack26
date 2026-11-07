import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory=fileURLToPath(new URL('../../dashboard/dist/',import.meta.url));
const local=host=>['127.0.0.1','localhost','::1','[::1]'].includes(host);
export function allowLocalDashboardSession(req,bindHost,port) {
  try {
    const origin=new URL(`http://${req.headers.host}`);
    return local(bindHost) && local(origin.hostname) && Number(origin.port || 80)===port &&
      req.headers.origin===origin.origin && req.headers['x-colony-dashboard']==='1';
  } catch {return false;}
}

export async function serveDashboard(req,res,path) {
  if(!['GET','HEAD'].includes(req.method))return false;
  let file;
  if(path==='/')file='index.html';
  else if(path==='/favicon.svg')file='favicon.svg';
  else if(/^\/assets\/[A-Za-z0-9_-]+\.(js|css|svg|woff2)$/.test(path))file=path.slice(1);
  else return false;
  try {
    const body=await readFile(join(directory,file));
    const type={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2'}[file.split('.').pop()];
    res.writeHead(200,{'content-type':`${type}; charset=utf-8`,'cache-control':file.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache',
      'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'"});
    res.end(req.method==='HEAD'?undefined:body);
  } catch {
    res.writeHead(file==='index.html'?503:404,{'content-type':'text/plain'});
    res.end('Dashboard assets are not built. Run npm run build:dashboard and refresh.');
  }
  return true;
}
