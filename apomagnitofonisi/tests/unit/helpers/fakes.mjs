/** Ψεύτικοι adapters για τα unit tests του application (ίδια συμβόλαια με το src/application/ports.js). */
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
  async clear() { this.items.clear(); }
}

export function fixedClock(iso = '2026-11-04T10:00:00.000Z') {
  return { nowIso: () => iso };
}

export function sequentialIds(prefix = 'id') {
  let n = 0;
  return { newId: () => `${prefix}-${++n}` };
}

export class FakeEngine {
  constructor(kind, result, { available = true, reason, qualityPresets } = {}) {
    this.kind = kind;
    this.result = result;
    this.availability = { available, ...(reason ? { reason } : {}) };
    this.availabilityRequests = [];
    this.requests = [];
    if (qualityPresets) this.describeQualityPresets = async () => qualityPresets;
  }
  async checkAvailability(options) { this.availabilityRequests.push(options); return this.availability; }
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
  constructor() { this.keys = new Map(); this.retention = 'device'; }
  getKey(p) { return this.keys.get(p) ?? null; }
  setKey(p, k) { this.keys.set(p, k); }
  removeKey(p) { this.keys.delete(p); }
  setKeyRetention(retention) { this.retention = retention; }
  getKeyRetention() { return this.retention; }
  clear() { this.keys.clear(); this.retention = 'device'; }
}

/** Θύρα DeviceStorage: μετρά τα αιτήματα μόνιμης αποθήκευσης. */
export class MemoryDeviceStorage {
  constructor(usage = { usageBytes: 5, quotaBytes: 10 }) { this.usage = usage; this.persistenceRequests = 0; }
  async estimateUsage() { return this.usage; }
  async requestPersistence() { this.persistenceRequests += 1; return true; }
}

export function fakeMedia({ name = 'Σύσκεψη.mp3', type = 'audio/mpeg', size = 1234 } = {}) {
  return { name, type, size };
}
