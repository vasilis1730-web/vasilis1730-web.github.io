/**
 * Εγγραφή του service worker και ειδοποίηση όταν περιμένει νέα έκδοση.
 * Το «Ανανέωση» στέλνει μήνυμα SKIP_WAITING (κοινό συμβόλαιο με το sw.js) και
 * η σελίδα ξαναφορτώνει μόλις ο νέος worker αναλάβει. Στην πρώτη επίσκεψη ο
 * worker αναλαμβάνει επίσης (clients.claim), αλλά τότε η σελίδα ΔΕΝ
 * ξαναφορτώνει: μόνο όταν το ζήτησε ο χρήστης.
 */
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';

export class ServiceWorkerClient {
  #container;
  #location;
  #waiting = null;
  #updateRequested = false;

  /** @param {{ serviceWorker: ServiceWorkerContainer|undefined, location: Location }} deps */
  constructor({ serviceWorker, location }) {
    this.#container = serviceWorker;
    this.#location = location;
  }

  /** @param {{ scriptUrl: string, onUpdateReady: () => void }} options */
  async register({ scriptUrl, onUpdateReady }) {
    if (!this.#container) return;
    this.#container.addEventListener('controllerchange', () => {
      if (!this.#updateRequested) return;
      this.#updateRequested = false;
      this.#location.reload();
    });
    const registration = await this.#container.register(scriptUrl, { type: 'classic' });
    const offer = worker => {
      this.#waiting = worker;
      onUpdateReady();
    };
    const track = worker => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && this.#container.controller) offer(worker);
      });
    };
    if (registration.waiting && this.#container.controller) offer(registration.waiting);
    if (registration.installing) track(registration.installing);
    registration.addEventListener('updatefound', () => registration.installing && track(registration.installing));
  }

  applyUpdate() {
    if (!this.#waiting) return;
    this.#updateRequested = true;
    this.#waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
  }
}
