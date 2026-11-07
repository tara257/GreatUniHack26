import pathfinderModule from 'mineflayer-pathfinder';
import { go, check, collectDrops } from './skills.js';
const {goals:{GoalFollow}}=pathfinderModule;
const foods=['cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','cooked_rabbit','cooked_cod','cooked_salmon','bread','baked_potato','apple','carrot','beef','porkchop','mutton','rabbit','sweet_berries'];
const animals=new Set(['cow','pig','sheep','rabbit']);

export function survivalDecision({health,hunger,food,animal}) {
  if (hunger>=18 && health>6) return null;
  if (food && hunger<20) return {type:'eat',item:food,say:'Eating to recover hunger and health'};
  if (hunger>=18) return {type:'rest',say:'Resting while health regenerates'};
  if (animal) return {type:'hunt',entityId:animal.id,say:`Finding food: hunting a ${animal.name}`};
  // No food nearby: explore without sprinting, instead of resting forever with no regeneration.
  if (hunger<=10 || health<=6) return {type:'explore',distance:8,say:'Searching nearby for food'};
  return null;
}

export function perceiveSurvival(ctx) {
  const bot=ctx.bot,held=new Set(bot.inventory.items().map(i=>i.name));
  const food=foods.find(name=>held.has(name));
  const animal=Object.values(bot.entities).filter(e=>animals.has(e.name) && (ctx.memory.failed.get('entity:'+e.id) || 0)<Date.now() && e.position.distanceTo(bot.entity.position)<32)
    .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
  const action=survivalDecision({health:bot.health,hunger:bot.food,food,animal});
  return action && {...action,angle:ctx.angle};
}

export const survivalActions={
  async eat(ctx,a) {
    const item=ctx.bot.inventory.items().find(i=>i.name===a.item);
    if (!item) return;
    await ctx.bot.equip(item,'hand');check(ctx);await ctx.bot.consume();check(ctx);
  },
  async hunt(ctx,a) {
    const bot=ctx.bot,deadline=Date.now()+18000;
    const weapon=bot.inventory.items().find(i=>/_sword$/.test(i.name)) || bot.inventory.items().find(i=>/_axe$/.test(i.name));
    if (weapon) await bot.equip(weapon,'hand');
    let lastPosition;
    while (Date.now()<deadline) {
      check(ctx);const animal=bot.entities[a.entityId];if(!animal)break;
      lastPosition=animal.position.clone();
      if (animal.position.distanceTo(bot.entity.position)>2.8) await go(ctx,new GoalFollow(animal,2),10000);
      check(ctx);if (!bot.entities[a.entityId]) break;
      await bot.lookAt(animal.position.offset(0,.5,0),true);bot.attack(animal);
      await new Promise(resolve=>setTimeout(resolve,700));
    }
    if(bot.entities[a.entityId])throw new Error('Animal escaped; looking for other food');
    if(lastPosition)await collectDrops(ctx,lastPosition,7);
  },
};
