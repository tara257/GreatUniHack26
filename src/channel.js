import { randomUUID } from 'node:crypto';

// Gameplay information only travels through Minecraft chat. No shared agent state.
export class TeamChannel {
  constructor({ state, send, save, learn }) {
    this.state = state;
    this.send = send;
    this.save = save;
    this.learn = learn;
    this.online = state.commsOnline ?? true;
    this.queue = [...state.history];
  }

  publish(kind, position) {
    const event = { id: randomUUID().slice(0, 8), kind,
      position: [position.x, position.y, position.z].map(Math.floor) };
    this.state.history.push(event);
    this.state.history = this.state.history.slice(-32);
    this.queue.push(event);
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
      this.queue = [...this.state.history];
      this.send('[TEAM SYNC] Please resend your discoveries.');
    }
  }

  tick() {
    if (!this.online || !this.queue.length) return;
    const event = this.queue.shift();
    this.send(`[TEAM ${event.id}] ${event.kind} at ${event.position.join(' ')}`);
  }

  receive(sender, message) {
    // Gate before parsing: disconnected agents never learn from blocked messages.
    if (!this.online) return false;
    if (message === '[TEAM SYNC] Please resend your discoveries.') {
      const queued = new Set(this.queue.map(event => event.id));
      for (const event of this.state.history) {
        if (!queued.has(event.id)) this.queue.push(event);
      }
      return true;
    }
    const match = /^\[TEAM ([a-f0-9]{8})\] (Wood|Stone|Sand|Water|Coal|Iron|Danger) at (-?\d+) (-?\d+) (-?\d+)$/.exec(message);
    if (!match) return false;
    const key = `${sender}:${match[1]}`;
    if (this.state.seen.includes(key)) return false;
    const event = { id: match[1], sender, kind: match[2], position: match.slice(3).map(Number) };
    if (event.position.some(value => !Number.isSafeInteger(value) || Math.abs(value) > 30_000_000)) return false;
    this.state.seen.push(key);
    this.state.seen = this.state.seen.slice(-512);
    this.state.knowledge.push(event);
    this.state.knowledge = this.state.knowledge.slice(-128);
    this.save();
    this.learn(event);
    return true;
  }
}
