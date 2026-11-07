const keyOf = p => p.map(Math.floor).join(',');
const distance = (a,b) => Math.hypot(...a.map((n,i)=>n-b[i]));
const TTL = { Danger: 90_000, Death: 600_000 };

// Small, inspectable episodic memory. This changes decisions, not model weights.
// Each instance belongs to exactly one bot; peer lessons arrive through chat.
export class Experience {
  constructor(state, save = () => {}, now = Date.now) {
    this.state = state;
    this.save = save;
    this.now = now;
    this.data = state.experience ??= {
      routes: {}, hazards: [], episodes: [],
      metrics: { navigationSuccesses: 0, navigationFailures: 0, deferredRoutes: 0, actions: {} },
      deathBaseline: state.deaths || 0,
    };
  }
  route(position) { return this.data.routes[keyOf(position)]; }
  blocked(position) { return (this.route(position)?.retryAt || 0) > this.now(); }
  failures(position) { return this.route(position)?.failures || 0; }
  episode(action, outcome, position, detail = '') {
    this.data.episodes.push({ time: this.now(), action, outcome,
      position: position.map(Math.floor), detail: detail.slice(0,100) });
    this.data.episodes = this.data.episodes.slice(-128);
  }
  trimRoutes() {
    this.data.routes = Object.fromEntries(Object.entries(this.data.routes)
      .sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,128));
  }
  failed(position, reason) {
    const key = keyOf(position), previous = this.route(position);
    const failures = Math.min(6,(previous?.failures || 0)+1);
    this.data.routes[key] = { ...previous, failures, updatedAt: this.now(),
      retryAt: this.now()+Math.min(180_000,15_000*2**(failures-1)) };
    this.data.metrics.navigationFailures++;
    this.episode('navigate','failed',position,reason);
    this.trimRoutes(); this.save();
  }
  succeeded(position) {
    const key = keyOf(position);
    this.data.routes[key] = { failures: 0, retryAt: 0, updatedAt: this.now(), lastSuccess: this.now() };
    this.data.metrics.navigationSuccesses++;
    this.episode('navigate','succeeded',position);
    this.trimRoutes(); this.save();
  }
  deferred() { this.data.metrics.deferredRoutes++; }
  action(action, position) {
    const counts = this.data.metrics.actions;
    counts[action] = (counts[action] || 0)+1;
    // Log decisions when they change, not every idle heartbeat.
    if (this.lastAction !== action) { this.episode(action,'selected',position); this.lastAction=action; }
  }
  observe(event) {
    if (event.kind === 'Blocked') {
      if (event.time+30_000 <= this.now()) return;
      const old=this.route(event.position);
      if ((old?.lastSuccess || 0) >= event.time) return;
      this.data.routes[keyOf(event.position)] = { ...old, failures: Math.max(1,old?.failures || 0),
        updatedAt: event.time, retryAt: Math.max(old?.retryAt || 0,event.time+30_000) };
      this.trimRoutes();
    } else if (TTL[event.kind]) {
      if (event.time+TTL[event.kind] <= this.now()) return;
      const id = `${event.sender || 'self'}:${event.id}`;
      if (this.data.hazards.some(h=>h.id===id)) return;
      this.data.hazards = this.data.hazards.filter(h=>h.time+TTL[h.kind]>this.now());
      this.data.hazards.push({ id, kind:event.kind, time:event.time, position:event.position });
      this.data.hazards=this.data.hazards.slice(-64);
    } else return;
    this.save();
  }
  risk(position) {
    // Decay old observations and use the strongest nearby signal. Repeated chat
    // must not make a place permanently forbidden or inflate its danger.
    return this.data.hazards.reduce((risk,h)=>{
      const remaining=Math.max(0,1-(this.now()-h.time)/TTL[h.kind]);
      const proximity=Math.max(0,1-distance(position,h.position)/7);
      return Math.max(risk,(h.kind==='Death'?8:5)*remaining*proximity);
    },0);
  }
  summary() {
    const m=this.data.metrics;
    return `Routes ${m.navigationSuccesses} OK/${m.navigationFailures} failed, ${m.deferredRoutes} avoided; deaths this version ${Math.max(0,(this.state.deaths || 0)-this.data.deathBaseline)}`;
  }
}
