/**
 * Το κέλυφος της εφαρμογής: επικεφαλίδα με πλοήγηση, κύρια περιοχή όπου
 * εμφανίζεται μία προβολή τη φορά, υποσέλιδο και περιοχή μηνυμάτων.
 *
 * Κάθε προβολή (View) έχει `title`, `render(context)` που επιστρέφει στοιχείο
 * DOM και προαιρετικά `dispose()`. Το context δίνει στην προβολή το
 * `refreshTitle()`: μια προβολή που φορτώνει δεδομένα αργότερα (π.χ. τον τίτλο
 * της μεταγραφής) αλλάζει το `title` της και το καλεί, χωρίς να γράφει η ίδια
 * στο document.title (OO-001). Σε κάθε αλλαγή η εστίαση πηγαίνει στην
 * επικεφαλίδα της νέας προβολής (για πληκτρολόγιο και αναγνώστες οθόνης).
 * Γι' αυτό μια προβολή κρατά το <h1> που επιστρέφει το render() και, όταν
 * έρθουν τα δεδομένα της, αλλάζει μόνο το κείμενό του, όχι το στοιχείο.
 *
 * @typedef {Object} ViewContext
 * @property {() => void} refreshTitle  ξαναδιαβάζει το `title` της προβολής
 *
 * @typedef {Object} View
 * @property {string} title
 * @property {'home'|'history'|'settings'} [navKey]  για την ένδειξη στην πλοήγηση
 * @property {(context: ViewContext) => HTMLElement} render
 * @property {() => void} [dispose]
 */
import { h } from './dom.js';
import { STRINGS } from './strings.js';
import { ROUTES, hrefFor } from './routes.js';
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
    const destinations = [['home', ROUTES.home()], ['history', ROUTES.history()], ['settings', ROUTES.settings()]];
    const nav = h('nav', { 'aria-label': STRINGS.nav.main },
      h('ul', {}, destinations.map(([key, path]) => {
        const link = h('a', { href: hrefFor(path) }, STRINGS.nav[key]);
        this.#navLinks.set(key, link);
        return h('li', {}, link);
      })));
    const header = h('header', { class: 'app-header' },
      h('a', { class: 'brand', href: hrefFor(ROUTES.home()) }, h('img', { src: './assets/icons/favicon.svg', alt: '', width: 28, height: 28 }), h('span', {}, STRINGS.appName)),
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
    this.#main.replaceChildren(view.render({ refreshTitle: () => this.updateTitle(view) }));
    this.updateTitle(view);
    for (const [key, link] of this.#navLinks) {
      if (key === view.navKey) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const heading = this.#main.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    this.#document.defaultView?.scrollTo?.(0, 0);
  }

  /** Ο τίτλος της καρτέλας από τον τίτλο της προβολής (μόνο της τρέχουσας). */
  updateTitle(view) {
    if (view !== this.#current) return;
    this.#document.title = !view.title || view.title === STRINGS.appName ? STRINGS.appName : `${view.title} | ${STRINGS.appName}`;
  }
}
