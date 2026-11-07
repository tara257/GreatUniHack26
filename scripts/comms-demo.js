import { runFailureSimulation } from './lib/comms-simulation.js';

const result=await runFailureSimulation({log:console.log});
console.table(result.agents);
console.log(`Recorded ${result.events} timestamped network and message events. No Minecraft connections were used.`);
