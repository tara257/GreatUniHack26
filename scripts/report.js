import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEAM } from '../src/house.js';

// Human-facing reporting only. Gameplay agents never read one another's files.
const directory=resolve(process.env.BOT_STATE_DIR || '.state');
const results=TEAM.map(name=>{
  try {
    const state=JSON.parse(readFileSync(resolve(directory,`${name}.json`),'utf8'));
    const memory=state.experience,metrics=memory?.metrics,t=state.telemetry;
    return {agent:name,task:t?.action || 'not recorded',health:t?Math.ceil(t.health):'?',food:t?.food ?? '?',
      house:t?`${t.house}/${t.total}`:'?',placed:state.placed || 0,
      newDeaths:memory?Math.max(0,state.deaths-memory.deathBaseline):'?',
      routesOK:metrics?.navigationSuccesses || 0,routesFailed:metrics?.navigationFailures || 0,
      retriesAvoided:metrics?.deferredRoutes || 0,comms:state.commsOnline===false?'OFF':'on',
      night:t?.night ?? '?',ageSeconds:t?Math.round((Date.now()-t.time)/1000):'?'};
  } catch { return {agent:name,task:'No readable state yet'}; }
});
console.table(results);
console.log('Snapshots are local observations, not a controlled performance benchmark. Age shows how recent each snapshot is.');
