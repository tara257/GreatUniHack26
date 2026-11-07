import { randomUUID } from 'node:crypto';

// Gameplay information only travels through Minecraft chat. No shared agent state.
export class TeamChannel {
  constructor({ state, send, save, learn }) {
    this.state = state;
    this.send = send;
    this.save = save;
    this.learn = learn;
    this.online = state.commsOnline ?? true;
    this.queue = state.history.filter(event => this.fresh(event));
  }

  fresh(event) {
    return event.kind !== 'Claim' || Date.now() - (event.time || 0) < 30_000;
  }

  publish(kind, position) {
    const event = { id: randomUUID().slice(0, 8), kind, time: Date.now(),
      position: [position.x, position.y, position.z].map(Math.floor) };
    this.state.history.push(event);
    this.state.history = this.state.history.slice(-32);
    // Claims are short leases and must not sit behind a discovery backlog.
    if (kind === 'Claim') this.queue.unshift(event); else this.queue.push(event);
    this.save();
    return event;
  }

  setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    this.state.commsOnline = online;
    this.save();
    if (online) {
      // Resend observations, and ask peers for anything missed during the outage.
      this.queue = this.state.history.filter(event => this.fresh(event));
      this.send('[TEAM SYNC] Please resend your discoveries.');
    }
  }

  tick() {
    if (!this.online || !this.queue.length) return;
    this.queue = this.queue.filter(event => this.fresh(event));
    const event = this.queue.shift();
    if (event) this.send(`[TEAM ${event.id}] ${event.kind} at ${event.position.join(' ')} @${event.time || 0}`);
  }

  receive(sender, message) {
    // Gate before parsing: disconnected agents never learn from blocked messages.
    if (!this.online) return false;
    if (message === '[TEAM SYNC] Please resend your discoveries.') {
      const queued = new Set(this.queue.map(event => event.id));
      for (const event of this.state.history) {
        if (!queued.has(event.id) && this.fresh(event)) this.queue.push(event);
      }
      return true;
    }
    const match = /^\[TEAM ([a-f0-9]{8})\] (Wood|Danger|Food|Claim|Built) at (-?\d+) (-?\d+) (-?\d+)(?: @(\d+))?$/.exec(message);
    if (!match) return false;
    const key = `${sender}:${match[1]}`;
    if (this.state.seen.includes(key)) return false;
    const event = { id: match[1], sender, kind: match[2], position: match.slice(3, 6).map(Number), time: Number(match[6] || 0) };
    if (event.position.some(value => !Number.isSafeInteger(value) || Math.abs(value) > 30_000_000)) return false;
    if (!Number.isSafeInteger(event.time) || event.time > Date.now() + 5000 || !this.fresh(event)) return false;
    this.state.seen.push(key);
    this.state.seen = this.state.seen.slice(-512);
    this.state.knowledge.push(event);
    this.state.knowledge = this.state.knowledge.slice(-128);
    this.save();
    this.learn(event);
    return true;
  }
}
