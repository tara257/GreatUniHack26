import { HOUSE, progress, survey } from './blueprint.js';
import { buildOrigin, Vec3 } from './world.js';

export function observeHouse(bot) {
  if(!bot?.spawnPoint || !bot.entity)return null;
  const origin=buildOrigin(bot),report=survey(HOUSE,origin,(x,y,z)=>bot.blockAt(new Vec3(x,y,z))?.name ?? null);
  const cells=Object.entries(report).filter(([kind])=>['complete','missing','obstructed','unknown'].includes(kind))
    .flatMap(([status,cells])=>cells.filter(c=>c.material!=='air').map(c=>({x:c.x-origin.x,y:c.y-origin.y,z:c.z-origin.z,status})));
  const phases=[['Foundation',0,0],['Walls & windows',1,2],['Roof',3,3]].map(([name,min,max])=>{
    const layer=cells.filter(c=>c.y>=min && c.y<=max);
    return {name,placed:layer.filter(c=>c.status==='complete').length,required:layer.length};
  });
  return {...progress(report),blueprint:HOUSE.name,observedAt:Date.now(),origin:{x:origin.x,y:origin.y,z:origin.z},
    unknown:cells.filter(c=>c.status==='unknown').length,phases,cells};
}
