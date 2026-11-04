/** Ψεύτικοι adapters για τα unit tests του application. */
export class MemoryRepository {
  constructor() { this.items = new Map(); this.saves = 0; }
  async save(t) { this.saves += 1; this.items.set(t.id, structuredClone(t)); }
  async findById(id) { return this.items.has(id) ? structuredClone(this.items.get(id)) : null; }
  async listNewestFirst() {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(t => ({
      id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, durationSec: t.source.durationSec,
      engineKind: t.engine.kind, segmentCount: t.segments.length, summaryCount: t.summaries.length,
    }));
  }
  async remove(id) { this.items.delete(id); }
  async removeAll() { this.items.clear(); }
}

export function fixedClock(iso = '2026-11-04T10:00:00.000Z') {
  return { nowIso: () => iso };
}

export function sequentialIds(prefix = 'id') {
  let n = 0;
  return { newId: () => `${prefix}-${++n}` };
}

export class FakeEngine {
  constructor(kind, result, { available = true, reason } = {}) {
    this.kind = kind;
    this.result = result;
    this.availability = { available, ...(reason ? { reason } : {}) };
    this.requests = [];
  }
  async checkAvailability() { return this.availability; }
  async recognize(request) {
    this.requests.push(request);
    request.onProgress?.({ stage: 'transcribing', fraction: 0.5 });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export class MemorySettingsStore {
  constructor(initial = null) { this.value = initial; }
  load() { return this.value; }
  save(v) { this.value = structuredClone(v); }
  clear() { this.value = null; }
}

export class MemoryKeyStore {
  constructor() { this.keys = new Map(); this.persistent = true; }
  getKey(p) { return this.keys.get(p) ?? null; }
  setKey(p, k) { this.keys.set(p, k); }
  removeKey(p) { this.keys.delete(p); }
  setPersistent(v) { this.persistent = v; }
  isPersistent() { return this.persistent; }
  clearAll() { this.keys.clear(); }
}

export function fakeMedia({ name = 'Σύσκεψη.mp3', type = 'audio/mpeg', size = 1234 } = {}) {
  return { name, type, size };
}
