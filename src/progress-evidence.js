// Instrumentation only. These counters never influence a role's decisions.
export const PROGRESS_METRICS = ['resourceBlocks', 'itemsCrafted', 'itemsDeposited', 'blocksPlaced', 'discoveries'];
export const emptyProgress = () => Object.fromEntries(PROGRESS_METRICS.map(key => [key, 0]));

export class ProgressEvidence {
  constructor() { this.setWindow(null); }
  setWindow(id) {
    if (this.windowId === id) return;
    this.windowId = id;
    this.totals = emptyProgress();
    this.lastAction = null;
  }
  begin() { return this.windowId; }
  record(ticket, metric, amount = 1, item = '') {
    // An operation straddling a link change is deliberately excluded.
    if (!ticket || ticket !== this.windowId || !PROGRESS_METRICS.includes(metric) || !Number.isSafeInteger(amount) || amount <= 0) return;
    this.totals[metric] += amount;
    this.lastAction = {metric, amount, item: String(item).slice(0, 64), at: Date.now()};
  }
  snapshot() { return {windowId: this.windowId, totals: {...this.totals}, lastAction: this.lastAction && {...this.lastAction}}; }
}
