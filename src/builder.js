import pathfinderModule from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { blueprint, progress, selectTask, matches, keyOf, SAFE_FOOD, priority } from './house.js';

const { goals: { GoalNear, GoalNearXZ, GoalLookAtBlock, GoalPlaceBlock } } = pathfinderModule;
const vector = p => new Vec3(...p);
const isLog = n => /(_log|_stem)$/.test(n);
const isPlank = n => n.endsWith('_planks');
const plants = /^(air|cave_air|short_grass|tall_grass|fern|large_fern|dandelion|poppy|snow)$/;
const hostile = /^(zombie|husk|drowned|skeleton|stray|creeper|spider|cave_spider|witch|pillager|vindicator|phantom)$/;
const prey = /^(cow|pig|sheep|rabbit)$/;

export class Builder {
  constructor({ bot, state, channel, index, save, say, log }) {
    Object.assign(this, { bot, state, channel, index, save, say, log });
    this.task = 'Waiting for !team start';
    this.failed = new Map();
    this.discovered = new Set();
    this.lastProgress = Date.now();
    this.lastCount = -1;
    this.active = null;
    this.lastWarning = 0;
    this.exploreStep = 0;
  }
  get plan() { return this.state.home ? blueprint(this.state.home) : []; }
  get home() { return vector(this.state.home); }
  items(test) { return this.bot.inventory.items().filter(i => test(i.name)); }
  count(test) { return this.items(test).reduce((n, i) => n + i.count, 0); }
  block(p) { return this.bot.blockAt(Array.isArray(p) ? vector(p) : p); }
  status() {
    const p = progress(this.plan, pos => this.block(pos));
    return `${this.task}. House ${p.complete}/${p.total}, health ${Math.ceil(this.bot.health)}/20, food ${this.bot.food}/20, logs ${this.count(isLog)}, planks ${this.count(isPlank)}, deaths ${this.state.deaths}, comms ${this.channel.online ? 'on' : 'OFF'}`;
  }
  narrate(text) {
    if (this.task !== text) { this.task = text; this.say(text); }
  }
  cancel() {
    if (this.active) this.active.cancelled = true;
    this.bot.pathfinder.setGoal(null);
    this.bot.stopDigging();
    this.bot.deactivateItem();
    this.bot.clearControlStates();
  }
  check() {
    if (!this.active || this.active.cancelled || !this.state.running || !this.bot.entity || this.bot.health <= 0) throw new Error('Task interrupted');
  }
  async wait(ms) { await new Promise(r => setTimeout(r, ms)); this.check(); }
  async go(goal) {
    this.check();
    const target = goal.pos || (Number.isFinite(goal.x) && Number.isFinite(goal.z) ? new Vec3(goal.x,goal.y ?? this.home.y+1,goal.z) : null);
    const inside = p => p.x >= this.home.x+1 && p.x < this.home.x+4 && p.z >= this.home.z+1 && p.z < this.home.z+4 && p.y < this.home.y+3;
    if (target && this.block(this.home.offset(2,1,0))?.name.endsWith('_door')) {
      if (inside(target) && !inside(this.bot.entity.position)) await this.passDoor(true);
      else if (!inside(target) && inside(this.bot.entity.position)) await this.passDoor(false);
    }
    // Pathfinder can stall below a low dirt ceiling after falling into a hollow.
    // Clearing natural headroom gives it space to plan a staircase out.
    const overhead = this.block(this.bot.entity.position.floored().offset(0,2,0));
    if (overhead && /^(dirt|grass_block)$/.test(overhead.name) && this.bot.canDigBlock(overhead)) {
      await this.bot.dig(overhead); this.check();
    }
    await this.bot.pathfinder.goto(goal); this.check();
  }
  async passDoor(enter) {
    // Vanilla door collision is unreliable in pathfinder. Approach normally,
    // open it, then walk through the doorway under the same survival interrupt.
    const approach = this.home.offset(2,1,enter ? -1 : 1);
    if (this.bot.entity.position.y >= this.home.y+3) {
      await this.bot.pathfinder.goto(new GoalNearXZ(this.home.x+2,this.home.z-2,0)); this.check();
    }
    await this.bot.pathfinder.goto(new GoalNearXZ(approach.x,approach.z,0)); this.check();
    await this.openDoor();
    const destination = this.home.offset(2.5,2.5,enter ? 2.5 : -1.5);
    await this.bot.lookAt(destination,true); this.check();
    this.bot.setControlState('forward',true);
    this.bot.setControlState('jump',true);
    try {
      for(let i=0;i<25;i++) {
        const z=this.bot.entity.position.z;
        if (enter ? z>=this.home.z+1.3 : z<this.home.z-0.5) break;
        await this.wait(100);
      }
    } finally {
      this.bot.setControlState('forward',false);
      this.bot.setControlState('jump',false);
    }
    const crossed=enter ? this.bot.entity.position.z>=this.home.z+1.3 : this.bot.entity.position.z<this.home.z-0.5;
    if (!crossed) throw new Error('Doorway is obstructed; trying again shortly');
    await this.closeDoor();
  }
  async travel(p, range = 3) {
    const me = this.bot.entity.position;
    const delta = p.minus(me); delta.y = 0;
    if (delta.norm() > 22) {
      // Short waypoints keep path searches bounded even after distant respawns.
      const next = me.plus(delta.normalize().scaled(14));
      await this.go(new GoalNearXZ(Math.floor(next.x),Math.floor(next.z),3));
    } else await this.go(new GoalNear(p.x,p.y,p.z,range));
  }
  threats() {
    const eye = this.bot.entity.position.offset(0,1.6,0);
    return Object.values(this.bot.entities).filter(e => {
      if (!hostile.test(e.name || '') || e.position.distanceTo(this.bot.entity.position) >= (e.name === 'creeper' ? 10 : 8)) return false;
      const line = e.position.offset(0,0.8,0).minus(eye);
      // An intact wall is protection; do not flee out of the house through it.
      return line.norm() < 0.1 || !this.bot.world.raycast(eye,line.normalize(),line.norm());
    });
  }
  dangerous(p) {
    return [...this.state.history, ...this.state.knowledge].some(e => e.kind === 'Danger' &&
      Date.now() - (e.time || 0) < 180_000 && vector(e.position).distanceTo(p) < 5);
  }
  claimed(p) {
    const latest = new Map();
    for (const e of this.state.knowledge) if (keyOf(e.position) === keyOf(p) &&
      (!latest.has(e.sender) || latest.get(e.sender).time < e.time)) latest.set(e.sender, e);
    return [...latest.values()].some(e => e.kind === 'Claim' && Date.now() - e.time < 30_000);
  }
  discover(kind, p) {
    const key = `${kind}:${p.floored()}`;
    if (this.discovered.has(key)) return;
    this.discovered.add(key);
    this.channel.publish(kind, p);
  }
  async tick() {
    if (!this.state.running || !this.bot.entity || this.bot.health <= 0) return;
    const threats = this.threats();
    if (this.active) {
      if (threats.length && this.active.kind !== 'escape') this.cancel();
      return;
    }
    if (!this.state.home) return this.narrate('Choose our house site: !team home X Y Z (floor corner)');
    const p = progress(this.plan, pos => this.block(pos));
    if (p.complete !== this.lastCount) { this.lastProgress = Date.now(); this.lastCount = p.complete; }
    const foodCount = this.count(n => SAFE_FOOD.has(n));
    const action = priority({ food: this.bot.food, health: this.bot.health, hasFood: foodCount > 0,
      threat: threats.length > 0, foodCount, complete: p.missing.length === 0 });
    const task = { kind: action, cancelled: false };
    this.active = task;
    const timeout = setTimeout(() => this.cancel(), 24_000);
    try {
      if (action === 'escape') await this.escape(threats);
      else if (action === 'eat') await this.eat();
      else if (action === 'forage') await this.forage();
      else if (action === 'recover') { this.narrate('Recovering at the shelter'); await this.returnHome(); }
      else if (action === 'maintain') await this.maintain();
      else await this.build(p);
    } catch (error) {
      if (!task.cancelled) this.log(`Replanning: ${error.message}`);
      if (Date.now() - this.lastWarning > 60_000 && !task.cancelled) {
        this.say('I hit an obstacle. Trying another route or job.'); this.lastWarning = Date.now();
      }
    } finally {
      clearTimeout(timeout);
      if (this.active === task) this.active = null;
    }
  }
  async eat() {
    const food = this.items(n => SAFE_FOOD.has(n)).sort((a,b) =>
      (this.bot.registry.foodsByName[b.name]?.foodPoints || 0) - (this.bot.registry.foodsByName[a.name]?.foodPoints || 0))[0];
    if (!food) return;
    this.narrate(`Eating ${food.displayName} before working`);
    await this.bot.equip(food, 'hand'); this.check();
    await this.bot.consume(); this.check();
  }
  async returnHome() {
    await this.openDoor();
    const target = this.home.offset(2, 1, 2);
    await this.go(new GoalNear(target.x, target.y, target.z, 1));
    await this.closeDoor();
  }
  async openDoor() {
    const door = this.block(this.home.offset(2, 1, 0));
    if (door?.name.endsWith('_door') && !door.getProperties().open && door.position.distanceTo(this.bot.entity.position) < 4) {
      await this.bot.activateBlock(door); this.check();
    }
  }
  async closeDoor() {
    const door = this.block(this.home.offset(2, 1, 0));
    if (door?.name.endsWith('_door') && door.getProperties().open && door.position.distanceTo(this.bot.entity.position) < 4) {
      await this.bot.activateBlock(door); this.check();
    }
  }
  async escape(threats) {
    const enemy = threats.sort((a,b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position))[0];
    if (Date.now() - (this.lastDanger || 0) > 15_000) {
      this.channel.publish('Danger', enemy.position); this.lastDanger = Date.now();
    }
    this.narrate(`Avoiding ${enemy.name}; survival comes first`);
    const me = this.bot.entity.position;
    if (enemy.name !== 'creeper' && me.distanceTo(enemy.position) < 3) {
      const weapon = this.items(n => n.endsWith('_axe') || n.endsWith('_sword'))[0];
      if (weapon) { await this.bot.equip(weapon, 'hand'); this.check(); }
      this.bot.attack(enemy);
    }
    const door = this.block(this.home.offset(2, 1, 0));
    if (door?.name.endsWith('_door') && this.home.distanceTo(me) < 18 && this.home.distanceTo(enemy.position) > 6) {
      await this.returnHome();
    } else {
      const away = me.minus(enemy.position); away.y = 0;
      if (away.norm() < 0.1) away.x = 1;
      const target = me.plus(away.normalize().scaled(10));
      await this.go(new GoalNear(Math.floor(target.x), Math.floor(target.y), Math.floor(target.z), 2));
    }
  }
  async forage() {
    if (await this.collectDrops(n => SAFE_FOOD.has(n), 12)) return;
    const animals = Object.values(this.bot.entities).filter(e => prey.test(e.name || '') &&
      e.position.distanceTo(this.bot.entity.position) < 40 && !this.dangerous(e.position) &&
      (this.failed.get(`animal:${e.id}`) || 0) < Date.now());
    animals.sort((a,b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position));
    if (!animals.length) return this.explore('Looking for food', 'Food');
    const animal = animals[0];
    this.discover('Food', animal.position);
    this.narrate(`Finding food: hunting a ${animal.name}`);
    this.failed.set(`animal:${animal.id}`, Date.now() + 90_000);
    const weapon = this.items(n => n.endsWith('_axe') || n.endsWith('_sword'))[0];
    if (weapon) { await this.bot.equip(weapon, 'hand'); this.check(); }
    else { await this.bot.unequip('hand'); this.check(); }
    for (let hits = 0; hits < 12 && this.bot.entities[animal.id]; hits++) {
      const p = animal.position;
      await this.go(new GoalNear(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 1));
      if (!this.bot.entities[animal.id]) break;
      if (p.distanceTo(this.bot.entity.position) <= 3) this.bot.attack(animal);
      await this.wait(900);
    }
    await this.wait(500);
    await this.collectDrops(n => SAFE_FOOD.has(n), 12);
  }
  async collectDrops(test, range = 8) {
    const drops = Object.values(this.bot.entities).filter(e => e.name === 'item' &&
      e.position.distanceTo(this.bot.entity.position) < range && test(e.getDroppedItem()?.name || '') &&
      (this.failed.get(`drop:${e.id}`) || 0) < Date.now());
    drops.sort((a,b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position));
    if (!drops.length) return false;
    const p = drops[0].position;
    const before = this.count(test);
    this.failed.set(`drop:${drops[0].id}`,Date.now()+30_000);
    try {
      await this.go(new GoalNear(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 1));
      await this.wait(450);
    } catch (error) { this.check(); this.log(`Skipping an unreachable dropped item: ${error.message}`); }
    return this.count(test) > before;
  }
  async explore(text, kind) {
    this.narrate(text);
    // Received discoveries are useful hints, never assumed to still exist.
    const known = [...this.state.knowledge].reverse().find(e => e.kind === kind &&
      !this.dangerous(vector(e.position)) && (this.failed.get(`hint:${e.id}`) || 0) < Date.now() &&
      vector(e.position).distanceTo(this.bot.entity.position) > 5 && vector(e.position).distanceTo(this.home) < 80);
    if (known) {
      this.failed.set(`hint:${known.id}`, Date.now() + 90_000);
      await this.travel(vector(known.position));
      return;
    }
    const angle = this.index * 2 * Math.PI / 3 + this.exploreStep++ * 0.8;
    const radius = 12 + this.exploreStep % 4 * 7;
    const p = this.home.offset(Math.round(Math.cos(angle) * radius), 0, Math.round(Math.sin(angle) * radius));
    await this.travel(p,4);
  }
  async mine(kind) {
    const wood = kind === 'wood';
    const dirt = kind === 'dirt';
    const wanted = n => wood ? isLog(n) : dirt ? ['dirt','grass_block'].includes(n) : ['stone','coal_ore'].includes(n);
    const dropped = n => wood ? isLog(n) : dirt ? n === 'dirt' : n === 'cobblestone' || n === 'coal';
    if (await this.collectDrops(dropped)) return;
    const positions = this.bot.findBlocks({ matching: b => b && wanted(b.name), maxDistance: dirt ? 12 : 32, count: 96 });
    const now = Date.now(), me = this.bot.entity.position;
    const candidates = positions.filter(p => (this.failed.get(p.toString()) || 0) < now && !this.dangerous(p) &&
      p.y <= me.y + 5 && p.y >= me.y - 6 && !this.plan.some(t => keyOf(t.position) === keyOf([p.x,p.y,p.z])) &&
      !(dirt && p.x >= this.home.x-1 && p.x <= this.home.x+5 && p.z >= this.home.z-1 && p.z <= this.home.z+5));
    const score = p => me.distanceTo(p) + 3 * (1 - Math.cos(Math.atan2(p.z-me.z,p.x-me.x) - this.index * Math.PI * 2/3));
    candidates.sort((a,b) => score(a) - score(b));
    if (!candidates.length) return this.explore(wood ? 'Searching for trees' : 'Searching for exposed stone', wood ? 'Wood' : 'Stone');
    const p = candidates[0];
    this.failed.set(p.toString(), now + 45_000);
    if (wood) this.discover('Wood', p);
    this.narrate(wood ? 'Gathering wood for our house' : dirt ? 'Gathering dirt scaffolding to reach the roof' : 'Mining stone for our furnace');
    await this.openDoor();
    await this.go(new GoalLookAtBlock(p, this.bot.world, { reach: 4.3 }));
    const block = this.block(p);
    if (!block || !wanted(block.name)) return;
    const tool = this.items(n => wood ? n.endsWith('_axe') : dirt ? n.endsWith('_shovel') : n.endsWith('_pickaxe'))[0];
    if (tool) { await this.bot.equip(tool, 'hand'); this.check(); }
    else if (!wood && !dirt) return;
    await this.bot.dig(block); this.check();
    await this.wait(400);
    await this.collectDrops(dropped, 10);
  }
  async craft(itemName, count = 1, table = null) {
    this.check();
    const item = this.bot.registry.itemsByName[itemName];
    const recipe = item && this.bot.recipesFor(item.id, null, 1, table)[0];
    if (!recipe) return false;
    if (table) await this.go(new GoalNear(table.position.x, table.position.y, table.position.z, 2));
    await this.bot.craft(recipe, count, table); this.check();
    return true;
  }
  async planks(minimum) {
    if (this.count(isPlank) >= minimum) return true;
    const batch = Math.max(24,minimum);
    if (this.count(isLog) * 4 + this.count(isPlank) < batch) { await this.mine('wood'); return false; }
    const log = this.items(isLog)[0];
    if (!log) { await this.mine('wood'); return false; }
    const plank = log.name.replace(/_(log|stem)$/, '_planks');
    await this.craft(plank, Math.min(log.count, Math.ceil((batch-this.count(isPlank))/4)));
    return this.count(isPlank) >= minimum;
  }
  table() { const b = this.block(this.home.offset(1,1,1)); return b?.name === 'crafting_table' ? b : null; }
  async tool(type) {
    if (this.items(n => n.endsWith(`_${type}`)).length) return true;
    const table = this.table();
    if (!table) return false;
    if (!await this.planks(5)) return false;
    if (this.count(n => n === 'stick') < 2) await this.craft('stick');
    return this.craft(`wooden_${type}`, 1, table);
  }
  async material(kind) {
    if (kind === 'planks') return this.planks(8);
    if (this.items(n => kind === 'door' ? n.endsWith('_door') : n === kind).length) return true;
    if (kind === 'crafting_table') return await this.planks(4) && this.craft('crafting_table');
    const table = this.table();
    if (!table) return false;
    if (kind === 'door') {
      if (!await this.planks(8)) return false;
      const plank = this.items(isPlank).find(i => i.count >= 6);
      if (!plank) {
        const log = this.items(isLog)[0];
        if (log) await this.craft(log.name.replace(/_(log|stem)$/,'_planks'));
        else await this.mine('wood');
        return false;
      }
      return this.craft(plank.name.replace('_planks', '_door'), 1, table);
    }
    if (kind === 'furnace') {
      if (!await this.tool('pickaxe')) return false;
      if (this.count(n => n === 'cobblestone') < 8) { await this.mine('stone'); return false; }
      return this.craft('furnace', 1, table);
    }
    if (kind === 'torch') {
      if (!this.count(n => n === 'stick')) {
        if (!await this.planks(2)) return false;
        await this.craft('stick');
      }
      if (!this.count(n => n === 'coal' || n === 'charcoal')) { await this.charcoal(); return false; }
      return this.craft('torch');
    }
    return false;
  }
  async charcoal() {
    const block = this.block(this.home.offset(3,1,1));
    if (block?.name !== 'furnace') return;
    if (this.claimed([block.position.x,block.position.y,block.position.z])) return;
    this.channel.publish('Claim', block.position);
    this.narrate('Making charcoal to light our shelter');
    await this.go(new GoalNear(block.position.x,block.position.y,block.position.z,2));
    const furnace = await this.bot.openFurnace(block);
    try {
      this.check();
      if (furnace.outputItem()) { await furnace.takeOutput(); this.check(); return; }
      if (!furnace.inputItem()) {
        const log = this.items(isLog)[0];
        if (!log) { furnace.close(); await this.mine('wood'); return; }
        await furnace.putInput(log.type, null, 1); this.check();
      }
      if (!furnace.fuelItem() && furnace.fuel <= 0) {
        const fuel = this.items(isPlank)[0];
        if (!fuel) { furnace.close(); await this.planks(2); return; }
        await furnace.putFuel(fuel.type, null, 1); this.check();
      }
    } finally { furnace.close(); }
  }
  async place(task) {
    const pos = vector(task.position);
    let existing = this.block(pos);
    if (matches(task, existing)) return;
    if (!existing) throw new Error('Building site is not loaded');
    if (!plants.test(existing.name)) throw new Error(`House site blocked by ${existing.name} at ${pos}`);
    if (existing.name !== 'air' && existing.name !== 'cave_air') {
      await this.go(new GoalLookAtBlock(pos,this.bot.world,{reach:4.3}));
      await this.bot.dig(existing); this.check();
    }
    const options = { range: 3.5 };
    if (task.kind === 'door' || task.kind === 'torch') options.faces = [new Vec3(0,-1,0)];
    if (task.kind === 'door') options.facing = 'south';
    const goal = new GoalPlaceBlock(pos,this.bot.world,options);
    if (!goal.facesPos.length) throw new Error('Waiting for a neighbouring support block');
    await this.openDoor();
    await this.go(goal);
    // A reached path can still be finishing a jump; wait for the real eye position.
    await this.wait(300);
    existing = this.block(pos);
    if (matches(task,existing)) return;
    if (!plants.test(existing?.name || '')) return;
    const eye = this.bot.entity.position.offset(0,1.6,0);
    // Pathfinder evaluates block centres; the final player position can be a few
    // centimetres off that ray. Still use a real adjacent face within normal reach.
    const face = goal.getFaceAndRef(eye) || goal.facesPos
      .map(([face,to,ref])=>({face,to,ref}))
      .filter(candidate=>candidate.to.distanceTo(eye)<4.3 && this.block(candidate.ref)?.boundingBox==='block')
      .sort((a,b)=>a.to.distanceTo(eye)-b.to.distanceTo(eye))[0];
    if (!face) throw new Error('Cannot reach the placement face');
    const item = this.items(n => task.kind === 'planks' ? isPlank(n) : task.kind === 'door' ? n.endsWith('_door') : n === task.kind)[0];
    if (!item) return;
    await this.bot.equip(item,'hand'); this.check();
    // Sneak avoids opening a workbench/furnace when it serves as support.
    this.bot.setControlState('sneak',true);
    try { await this.bot.placeBlock(this.block(face.ref),face.face.scaled(-1)); this.check(); }
    finally { this.bot.setControlState('sneak',false); }
    if (matches(task,this.block(pos))) {
      this.channel.publish('Built',pos);
      this.state.placed = (this.state.placed || 0) + 1; this.save();
    }
  }
  async build(p) {
    if (this.bot.entity.position.distanceTo(this.home) > 80) {
      this.narrate('Returning to our agreed house site');
      await this.travel(this.home.offset(2,1,2),5); return;
    }
    const hasOwnWork = p.missing.some(t => t.phase === p.phase && t.owner === this.index &&
      (this.failed.get(keyOf(t.position)) || 0) <= Date.now());
    if (hasOwnWork) this.idleSince = null;
    else this.idleSince ??= Date.now();
    const target = selectTask({ ...p, index:this.index,
      stalledMs:Math.max(Date.now()-this.lastProgress,this.idleSince ? Date.now()-this.idleSince : 0),
      unavailable:t => (this.failed.get(keyOf(t.position)) || 0) > Date.now(),
      claimed:t => this.claimed(t.position) });
    if (!target) {
      const reserve = Math.min(12,p.missing.filter(t=>t.kind==='planks').length);
      if (this.count(isPlank) < reserve) await this.planks(reserve);
      else if (this.table() && !this.items(n=>n.endsWith('_axe')).length) await this.tool('axe');
      else {
        this.narrate('Watching progress; ready to take over unfinished work');
        // Waiting on an unfinished floor cell can prevent a teammate placing it.
        const staging = this.home.offset(this.index * 2,0,-3);
        if (this.bot.entity.position.distanceTo(staging) > 2) await this.travel(staging,1);
        else await this.wait(1000);
      }
      return;
    }
    if (!await this.material(target.kind)) return;
    if (this.bot.entity.position.distanceTo(this.home) > 18) {
      this.narrate('Bringing supplies back to the house');
      await this.travel(this.home.offset(2,1,2),5); return;
    }
    if (target.phase === 4 && this.count(n=>n==='dirt') < 4) {
      await this.mine('dirt'); return;
    }
    this.channel.publish('Claim',vector(target.position));
    this.narrate(`Building our ${['floor','workbench','walls','walls','roof','door','furnace','lighting'][target.phase]} (${p.complete}/${p.total})`);
    this.failed.set(keyOf(target.position),Date.now()+12_000);
    await this.place(target);
  }
  async maintain() {
    this.narrate('House complete! Keeping watch, finding food, and repairing damage');
    if (this.bot.entity.position.distanceTo(this.home.offset(2,1,2)) > 2) await this.returnHome();
    await this.closeDoor();
    await this.wait(1500);
  }
}
