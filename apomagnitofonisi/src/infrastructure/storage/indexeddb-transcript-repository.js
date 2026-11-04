/**
 * Οι μεταγραφές στο IndexedDB της συσκευής (βάση «apomagnitofonisi», store
 * «transcripts» με κλειδί id και ευρετήριο createdAt). Υλοποιεί τη θύρα
 * TranscriptRepository. Τίποτα δεν φεύγει από τη συσκευή.
 */
import { openDatabase, requestToPromise, transactionDone } from './idb.js';

export const DATABASE_NAME = 'apomagnitofonisi';
const DATABASE_VERSION = 1;
const STORE = 'transcripts';

export class IndexedDbTranscriptRepository {
  #factory;
  #database = null;

  /** @param {{ indexedDB: IDBFactory }} deps */
  constructor({ indexedDB }) {
    this.#factory = indexedDB;
  }

  async save(transcript) {
    const tx = (await this.#db()).transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(transcript);
    await transactionDone(tx);
  }

  async findById(id) {
    const tx = (await this.#db()).transaction(STORE, 'readonly');
    return (await requestToPromise(tx.objectStore(STORE).get(id))) || null;
  }

  /** @returns {Promise<import('../../application/ports.js').TranscriptListItem[]>} */
  async listNewestFirst() {
    const tx = (await this.#db()).transaction(STORE, 'readonly');
    const all = await requestToPromise(tx.objectStore(STORE).index('createdAt').getAll());
    return all.reverse().map(t => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      durationSec: t.source ? t.source.durationSec : null,
      engineKind: t.engine.kind,
      segmentCount: t.segments.length,
      summaryCount: t.summaries.length,
    }));
  }

  async remove(id) {
    const tx = (await this.#db()).transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await transactionDone(tx);
  }

  async removeAll() {
    const tx = (await this.#db()).transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await transactionDone(tx);
  }

  async #db() {
    if (!this.#database) {
      this.#database = openDatabase(this.#factory, DATABASE_NAME, DATABASE_VERSION, db => {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }).catch(error => {
        this.#database = null;
        throw error;
      });
    }
    return this.#database;
  }
}
