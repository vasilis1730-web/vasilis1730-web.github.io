/**
 * Αρχεία που έστειλαν στην εφαρμογή άλλες εφαρμογές με «Κοινή χρήση» (Web
 * Share Target). Ο service worker τα αποθηκεύει στην cache SHARE_INBOX_CACHE
 * και ανοίγει τη σελίδα με ?shared=1. Εδώ διαβάζονται και σβήνονται.
 *
 * Τα ονόματα (cache, header) είναι κοινό συμβόλαιο με το sw.js.
 */
export const SHARE_INBOX_CACHE = 'apomagnitofonisi-share-inbox';
export const SHARED_FILE_NAME_HEADER = 'X-Shared-File-Name';

export class SharedFileInbox {
  #caches;

  /** @param {{ caches: CacheStorage|undefined }} deps */
  constructor({ caches }) {
    this.#caches = caches;
  }

  /** @returns {Promise<File[]>} τα αρχεία που περίμεναν (και σβήνονται από την cache) */
  async takeFiles() {
    if (!this.#caches) return [];
    const cache = await this.#caches.open(SHARE_INBOX_CACHE);
    const files = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        const name = decodeURIComponent(response.headers.get(SHARED_FILE_NAME_HEADER) || 'αρχείο');
        files.push(new File([blob], name, { type: blob.type || response.headers.get('Content-Type') || '' }));
      }
      await cache.delete(request);
    }
    return files;
  }
}
