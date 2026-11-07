// Speed the demo up so the finished house can be seen quickly.
// Usage: npm run boost               speed, haste and no hunger for every bot; better starting tools
//        npm run boost -- materials  also hand the builder every block the house needs
// Effects are cleared when a bot dies; run it again if that happens.
import { sendCommands } from './cmd.js';
import { ROSTER } from '../src/roster.js';
import { blueprintNeeds } from '../src/blueprint.js';

const withMaterials = process.argv.includes('materials');
const nameOf = role => ROSTER.find(m => m.role === role).name;
// Blueprint groups to concrete items for the builder's kit.
const ITEM = { cobblestone: 'cobblestone', planks: 'oak_planks', log: 'oak_log', door: 'oak_door', glass_pane: 'glass_pane', stairs: 'oak_stairs' };

const commands = [];
for (const { name } of ROSTER) {
  commands.push(
    `effect give ${name} speed infinite 2 true`,      // faster walking (bots account for it in their physics)
    `effect give ${name} haste infinite 2 true`,      // faster digging and chopping
    `effect give ${name} saturation infinite 0 true`, // never hungry
  );
}
commands.push(`give ${nameOf('miner')} stone_pickaxe`, `give ${nameOf('lumberjack')} iron_axe`);
if (withMaterials) {
  for (const [group, count] of Object.entries(blueprintNeeds())) commands.push(`give ${nameOf('builder')} ${ITEM[group]} ${count}`);
}
commands.push(`say Boost applied${withMaterials ? '; the builder has every block for the house' : ''}.`);
sendCommands(commands);
console.log(`Sent ${commands.length} commands. ${withMaterials ? 'The builder can now build the whole house straight away.' : 'Add "materials" to give the builder the full house kit.'}`);
