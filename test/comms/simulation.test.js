import test from 'node:test';
import assert from 'node:assert/strict';
import { runFailureSimulation } from '../../scripts/lib/comms-simulation.js';

test('five separate agent processes work through three partitions and synchronize after manual recovery',async()=>{
  const result=await runFailureSimulation();
  assert.equal(result.agents.length,5);
  assert.ok(result.agents.every(a=>a.steps>25 && a.knownPeers===4 && a.minecraftConnected));
});
