import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.js';

const execute=promisify(execFile);
test('operator CLI controls real links and prints their effective status',async t=>{
  const f=await fixture(t);await f.agent('A');await f.agent('B');await f.agent('C');
  const cli=fileURLToPath(new URL('../../scripts/comms-control.js',import.meta.url));
  const run=(...args)=>execute(process.execPath,[cli,...args],{env:{...process.env,
    COMMS_HTTP_URL:f.urls.httpUrl,COMMS_OPERATOR_TOKEN:'test-operator'},timeout:5000});
  await run('partition','A,B','C');
  assert.equal(f.relay.snapshot().links.filter(l=>l.canCommunicate).length,1);
  await run('isolate','A');assert.ok(f.relay.snapshot().links.every(l=>!l.canCommunicate));
  await run('restore','A');assert.equal(f.relay.snapshot().links.filter(l=>l.canCommunicate).length,1);
  await run('heal');assert.ok(f.relay.snapshot().links.every(l=>l.canCommunicate));
  await run('link','A','B','off');
  const result=await run('status');assert.match(result.stdout,/canCommunicate/);assert.match(result.stdout,/link-disabled/);
  await assert.rejects(run('link','A','B','invalid'),/Usage/);
});
