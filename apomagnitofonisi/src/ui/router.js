/**
 * Δρομολόγηση με hash (#/history, #/t/<id>/summary): δουλεύει από στατικό
 * hosting χωρίς ρυθμίσεις server και μέσα στην εφαρμογή Android (TWA).
 *
 * Κωδικοποίηση (API-017): τα ROUTES κωδικοποιούν κάθε παράμετρο ΜΙΑ φορά
 * (encodeURIComponent) και ο router την αποκωδικοποιεί ΜΙΑ φορά, ανά
 * παράμετρο. Το `currentPath` έχει την ίδια μορφή με το `navigate()` και τα
 * ROUTES (κωδικοποιημένη), άρα `router.currentPath === ROUTES.transcript(id)`
 * ισχύει για κάθε id. Ένα χαλασμένο hash (π.χ. `#/t/%`, κομμένος σύνδεσμος)
 * δεν ταιριάζει σε καμία διαδρομή και πηγαίνει στην εναλλακτική, χωρίς σφάλμα.
 *
 * @typedef {Object} Route
 * @property {string} pattern  π.χ. '/t/:id/summary' (μόνο ASCII)
 * @property {(params: Record<string, string>) => void} show  οι παράμετροι αποκωδικοποιημένες
 */
export class HashRouter {
  #routes;
  #window;
  #fallback;

  /**
   * @param {{ window: Window, routes: Route[], fallback: () => void }} options
   */
  constructor({ window, routes, fallback }) {
    this.#window = window;
    this.#routes = routes.map(route => ({ ...route, matcher: compile(route.pattern) }));
    this.#fallback = fallback;
  }

  start() {
    this.#window.addEventListener('hashchange', () => this.#dispatch());
    this.#dispatch();
  }

  /**
   * Πλοήγηση: νέα εγγραφή στο ιστορικό του browser.
   * @param {string} path  διαδρομή από τα ROUTES (κωδικοποιημένη)
   */
  navigate(path) {
    const hash = `#${path}`;
    if (this.#window.location.hash === hash) this.#dispatch();
    else this.#window.location.hash = hash;
  }

  /** Η τρέχουσα διαδρομή, στην ίδια (κωδικοποιημένη) μορφή με τα ROUTES. */
  get currentPath() {
    return this.#window.location.hash.replace(/^#/, '') || '/';
  }

  #dispatch() {
    const path = this.currentPath;
    for (const route of this.#routes) {
      const params = route.matcher(path);
      if (params) { route.show(params); return; }
    }
    this.#fallback();
  }
}

/** Ταίριασμα μιας διαδρομής: οι παράμετροι αποκωδικοποιημένες, ή null. */
function compile(pattern) {
  const names = [];
  const regex = new RegExp(`^${pattern.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_, name) => { names.push(name); return '([^/]+)'; })}$`);
  return path => {
    const match = path.match(regex);
    if (!match) return null;
    const params = {};
    for (const [index, name] of names.entries()) {
      const value = decodeOnce(match[index + 1]);
      if (value === null) return null;
      params[name] = value;
    }
    return params;
  };
}

/** Μία αποκωδικοποίηση, ή null για χαλασμένη κωδικοποίηση (π.χ. σκέτο «%»). */
function decodeOnce(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
