/** Τυχαία αναγνωριστικά (θύρα IdGenerator), από το crypto.randomUUID του browser. */
export function createRandomIdGenerator(cryptoApi = globalThis.crypto) {
  return Object.freeze({ newId: () => cryptoApi.randomUUID() });
}
