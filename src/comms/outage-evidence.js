import { randomUUID } from 'node:crypto';
import { PROGRESS_METRICS, emptyProgress } from '../progress-evidence.js';

// Operator-only measurement. A window token marks a topology, never a task assignment.
export class OutageEvidence {
  constructor() { this.history = []; this.active = null; this.signature = ''; }
  topology(links, reason, now = Date.now()) {
    const blocked = links.filter(link => !link.policyAllowed).map(({a,b}) => [a,b].sort()).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const signature = JSON.stringify(blocked);
    if (signature === this.signature) return;
    this.finish(reason, now);
    this.signature = signature;
    if (!blocked.length) return;
    const ids = [...new Set(blocked.flat())];
    this.active = {id: randomUUID(), startedAt: now, endedAt: null, reason, endReason: null,
      blockedLinks: blocked, agents: ids.map(id => ({id, blockedPeers: blocked.filter(pair => pair.includes(id)).length,
        totalPeers: links.filter(link => link.a === id || link.b === id).length,
        totals: emptyProgress(), segmentTotals: emptyProgress(), epoch: null, lastReceivedAt: null,
        firstReceivedAt: null, minecraft: 'unknown', samples: 0, interruptions: 0, lastAction: null})), house: null};
    this.history.push(this.active);
    if (this.history.length > 8) this.history.shift();
  }
  finish(reason, now = Date.now()) {
    if (!this.active) return;
    this.active.endedAt = now; this.active.endReason = reason; this.active = null;
  }
  reset(links, now = Date.now()) {
    this.finish('simulation-reset', now); this.history = []; this.signature = '';
    this.topology(links, 'simulation-reset', now);
  }
  observe(id, report, now = Date.now()) {
    const capture = this.active, progress = report.payload.progress, epoch = report.stateVersion?.epoch;
    // Replayed reports from before the outage or a previous window cannot count.
    if (!capture || progress?.windowId !== capture.id || !Number.isSafeInteger(epoch) || epoch < 1) return;
    if (!progress.totals || PROGRESS_METRICS.some(key => !Number.isSafeInteger(progress.totals[key]) || progress.totals[key] < 0 || progress.totals[key] > 1e9)) return;
    const row = capture.agents.find(agent => agent.id === id);
    if (row) {
      if (row.epoch !== null && epoch < row.epoch) return;
      if (row.epoch === epoch && PROGRESS_METRICS.some(key => progress.totals[key] < row.segmentTotals[key])) return;
      const previous = row.epoch === epoch ? row.segmentTotals : emptyProgress();
      if (row.epoch !== null && row.epoch !== epoch) row.interruptions++;
      for (const key of PROGRESS_METRICS) row.totals[key] += progress.totals[key] - previous[key];
      row.segmentTotals = {...progress.totals}; row.epoch = epoch; row.samples++;
      row.firstReceivedAt ??= now; row.lastReceivedAt = now;
      row.simulated = report.payload.details?.simulated === true;
      row.minecraft = report.payload.minecraft?.connected === true ? 'connected' : report.payload.minecraft?.connected === false ? 'disconnected' : 'unknown';
      row.lastAction = progress.lastAction && typeof progress.lastAction === 'object' ? {
        metric: String(progress.lastAction.metric).slice(0,64), amount: progress.lastAction.amount,
        item: String(progress.lastAction.item || '').slice(0,64), at: progress.lastAction.at} : null;
    }
    const h = report.payload.house;
    if (report.payload.minecraft?.connected !== true || !h || h.unknown !== 0 || !Number.isInteger(h.placed) || !Number.isInteger(h.required) || h.placed < 0 || h.placed > h.required || h.required <= 0 || !h.origin) return;
    const site = JSON.stringify([h.blueprint, h.origin.x, h.origin.y, h.origin.z, h.required]);
    if (!capture.house) capture.house = {agentId:id,site,before:h.placed,after:h.placed,required:h.required,firstReceivedAt:now,lastReceivedAt:now,siteChanged:false};
    else if (capture.house.agentId === id) {
      if (capture.house.site !== site) capture.house.siteChanged = true;
      if (!capture.house.siteChanged) { capture.house.after = h.placed; capture.house.lastReceivedAt = now; }
    }
  }
  disconnected(id) {
    const row = this.active?.agents.find(agent => agent.id === id);
    if (row) { row.minecraft = 'unverified'; row.interruptions++; }
  }
  snapshot() { return {activeId:this.active?.id || null, captures:structuredClone(this.history)}; }
}
