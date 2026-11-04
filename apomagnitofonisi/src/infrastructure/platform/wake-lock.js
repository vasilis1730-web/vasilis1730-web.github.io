/**
 * Η οθόνη μένει ανοιχτή όσο τρέχει μια μεταγραφή (Screen Wake Lock API), γιατί
 * σε κινητό με σβηστή οθόνη ο browser παγώνει τη σελίδα. Όταν η σελίδα
 * ξαναγίνει ορατή, το κλείδωμα ζητείται ξανά. Χωρίς υποστήριξη δεν κάνει τίποτα.
 */
export class ScreenWakeLock {
  #navigator;
  #document;
  #sentinel = null;
  #wanted = false;
  #onVisibility = () => {
    if (this.#wanted && this.#document.visibilityState === 'visible') this.#request();
  };

  /** @param {{ navigator: Navigator, document: Document }} deps */
  constructor({ navigator, document }) {
    this.#navigator = navigator;
    this.#document = document;
  }

  get supported() {
    return Boolean(this.#navigator && this.#navigator.wakeLock);
  }

  async acquire() {
    if (!this.supported || this.#wanted) return;
    this.#wanted = true;
    this.#document.addEventListener('visibilitychange', this.#onVisibility);
    await this.#request();
  }

  async release() {
    this.#wanted = false;
    this.#document.removeEventListener('visibilitychange', this.#onVisibility);
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    if (sentinel) await sentinel.release().catch(() => {});
  }

  async #request() {
    try {
      this.#sentinel = await this.#navigator.wakeLock.request('screen');
    } catch {
      this.#sentinel = null;
    }
  }
}
