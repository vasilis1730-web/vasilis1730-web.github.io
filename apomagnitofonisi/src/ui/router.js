/**
 * Δρομολόγηση με hash (#/history, #/t/<id>/summary): δουλεύει από στατικό
 * hosting χωρίς ρυθμίσεις server και μέσα στην εφαρμογή Android (TWA).
 *
 * @typedef {Object} Route
 * @property {string} pattern  π.χ. '/t/:id/summary'
 * @property {(params: Record<string, string>) => void} show
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

  /** Πλοήγηση: νέα εγγραφή στο ιστορικό του browser. */
  navigate(path) {
    const hash = `#${path}`;
    if (this.#window.location.hash === hash) this.#dispatch();
    else this.#window.location.hash = hash;
  }

  get currentPath() {
    return decodeURI(this.#window.location.hash.replace(/^#/, '')) || '/';
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

function compile(pattern) {
  const names = [];
  const regex = new RegExp(`^${pattern.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_, name) => { names.push(name); return '([^/]+)'; })}$`);
  return path => {
    const match = path.match(regex);
    if (!match) return null;
    return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
  };
}
