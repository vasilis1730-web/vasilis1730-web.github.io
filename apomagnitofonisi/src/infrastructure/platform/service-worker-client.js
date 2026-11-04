/**
 * Εγγραφή του service worker και ειδοποίηση όταν περιμένει νέα έκδοση.
 * Το «Ανανέωση» στέλνει μήνυμα SKIP_WAITING (κοινό συμβόλαιο με το sw.js) και
 * η σελίδα ξαναφορτώνει μόλις ο νέος worker αναλάβει.
 */
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';

export class ServiceWorkerClient {
  #container;
  #location;
  #waiting = null;

  /** @param {{ serviceWorker: ServiceWorkerContainer|undefined, location: Location }} deps */
  constructor({ serviceWorker, location }) {
    this.#container = serviceWorker;
    this.#location = location;
  }

  /** @param {{ scriptUrl: string, onUpdateReady: () => void }} options */
  async register({ scriptUrl, onUpdateReady }) {
    if (!this.#container) return;
    let reloading = false;
    this.#container.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      this.#location.reload();
    });
    const registration = await this.#container.register(scriptUrl, { type: 'classic' });
    const track = worker => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && this.#container.controller) { this.#waiting = worker; onUpdateReady(); }
      });
    };
    if (registration.waiting && this.#container.controller) { this.#waiting = registration.waiting; onUpdateReady(); }
    if (registration.installing) track(registration.installing);
    registration.addEventListener('updatefound', () => registration.installing && track(registration.installing));
  }

  applyUpdate() {
    if (this.#waiting) this.#waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
  }
}
