export const VERSION = 1;
export const MESSAGE_TYPES = Object.freeze(['STATUS_UPDATE','RESOURCE_REQUEST','RESOURCE_UPDATE','TASK_COMPLETE','TASK_REQUEST','HEARTBEAT']);
export const LIMITS = Object.freeze({ maxPayloadBytes: 16_384, defaultTtlMs: 60_000, maxTtlMs: 300_000 });
export const validId = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
export const object = value => value !== null && typeof value==='object' && !Array.isArray(value);
const text = (value,max=256) => typeof value==='string' && value.length>0 && value.length<=max;
const quantity = value => Number.isSafeInteger(value) && value>=0 && value<=1_000_000_000;

export class ProtocolError extends Error {
  constructor(code,message,retryable=false) { super(message); Object.assign(this,{code,retryable}); }
}
export function requireThat(condition,message) {
  if (!condition) throw new ProtocolError('INVALID_MESSAGE',message);
}
export function validateMessage(input,from) {
  requireThat(object(input),'message must be an object');
  requireThat(text(input.id,128),'id must be a non-empty string of at most 128 characters');
  requireThat(MESSAGE_TYPES.includes(input.type),'unsupported message type');
  requireThat(input.to==='*' || input.to==='@relay' || validId(input.to),'invalid recipient');
  requireThat(input.from===undefined || input.from===from,'from must match the registered identity');
  requireThat(Number.isSafeInteger(input.sentAt) && input.sentAt>=0,'sentAt must be an epoch-millisecond integer');
  const ttlMs=input.ttlMs ?? LIMITS.defaultTtlMs;
  requireThat(Number.isInteger(ttlMs) && ttlMs>=50 && ttlMs<=LIMITS.maxTtlMs,'ttlMs must be 50–300000');
  requireThat(input.correlationId===undefined || text(input.correlationId,128),'invalid correlationId');
  const p=input.payload;
  requireThat(object(p),'payload must be an object');
  if (input.type==='STATUS_UPDATE') {
    if (p.minecraft!==undefined) requireThat(object(p.minecraft) && typeof p.minecraft.connected==='boolean','minecraft.connected must be boolean');
    for (const field of ['health','hunger']) if (p[field]!==undefined) requireThat(Number.isFinite(p[field]) && p[field]>=0 && p[field]<=20,`${field} must be 0–20`);
    if (p.position!==undefined) requireThat(object(p.position) && ['x','y','z'].every(k=>Number.isFinite(p.position[k])),'position requires finite x, y, z');
    if (p.task!==undefined) requireThat(text(p.task),'task must be a short string');
  }
  if (input.type==='RESOURCE_REQUEST') requireThat(validId(p.resource) && quantity(p.amount) && p.amount>0,'resource and positive integer amount are required');
  if (input.type==='RESOURCE_UPDATE') requireThat(object(p.resources) && Object.keys(p.resources).length<=128 &&
    Object.entries(p.resources).every(([name,count])=>validId(name) && quantity(count)),'resources must map resource names to non-negative integer totals');
  if (input.type==='TASK_COMPLETE') requireThat(text(p.taskId,128),'taskId is required');
  if (input.type==='TASK_REQUEST') requireThat(text(p.requestId,128),'requestId is required');
  if (input.type==='HEARTBEAT' && p.uptimeMs!==undefined) requireThat(Number.isSafeInteger(p.uptimeMs) && p.uptimeMs>=0,'uptimeMs must be non-negative');
  return {id:input.id,type:input.type,from,to:input.to,sentAt:input.sentAt,ttlMs,
    ...(input.correlationId===undefined?{}:{correlationId:input.correlationId}),payload:p};
}

// Stable equality for retries even when JSON object keys are in a different order.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
