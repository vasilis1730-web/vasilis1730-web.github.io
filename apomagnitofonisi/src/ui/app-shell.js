/**
 * Το κέλυφος της εφαρμογής: επικεφαλίδα με πλοήγηση, κύρια περιοχή όπου
 * εμφανίζεται μία προβολή τη φορά, υποσέλιδο και περιοχή μηνυμάτων.
 *
 * Κάθε προβολή (View) έχει `title`, `render()` που επιστρέφει στοιχείο DOM και
 * προαιρετικά `dispose()`. Σε κάθε αλλαγή η εστίαση πηγαίνει στην
 * επικεφαλίδα της νέας προβολής (για πληκτρολόγιο και αναγνώστες οθόνης).
 *
 * @typedef {Object} View
 * @property {string} title
 * @property {string} [navKey]  'home' | 'history' | 'settings', για την ένδειξη στην πλοήγηση
 * @property {() => HTMLElement} render
 * @property {() => void} [dispose]
 */
import { h } from './dom.js';
import { STRINGS } from './strings.js';
import { ToastHost } from './components/toast.js';

export class AppShell {
  #document;
  #main;
  #navLinks = new Map();
  #current = null;
  /** @type {ToastHost} */
  toasts;

  /** @param {{ document: Document, root: HTMLElement, privacyHref: string }} options */
  constructor({ document, root, privacyHref }) {
    this.#document = document;
    const nav = h('nav', { 'aria-label': STRINGS.nav.main },
      h('ul', {}, [['home', '#/'], ['history', '#/history'], ['settings', '#/settings']].map(([key, href]) => {
        const link = h('a', { href }, STRINGS.nav[key]);
        this.#navLinks.set(key, link);
        return h('li', {}, link);
      })));
    const header = h('header', { class: 'app-header' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: './assets/icons/favicon.svg', alt: '', width: 28, height: 28 }), h('span', {}, STRINGS.appName)),
      nav);
    this.#main = h('main', { id: 'main', tabIndex: -1 });
    const footer = h('footer', { class: 'app-footer' },
      h('p', {}, STRINGS.footer.independent, ' ', h('a', { href: privacyHref }, STRINGS.footer.privacy)));
    const toastRegion = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    this.toasts = new ToastHost(toastRegion);
    root.replaceChildren(header, this.#main, footer, toastRegion);
  }

  /** @param {View} view */
  show(view) {
    this.#current?.dispose?.();
    this.#current = view;
    this.#main.replaceChildren(view.render());
    this.#document.title = view.title === STRINGS.appName ? STRINGS.appName : `${view.title} | ${STRINGS.appName}`;
    for (const [key, link] of this.#navLinks) {
      if (key === view.navKey) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const heading = this.#main.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    this.#document.defaultView?.scrollTo?.(0, 0);
  }
}
