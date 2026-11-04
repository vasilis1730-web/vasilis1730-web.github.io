/**
 * Μικροί βοηθοί για τη δημιουργία στοιχείων DOM χωρίς innerHTML: όλα τα
 * κείμενα μπαίνουν με textContent, άρα τίποτα από αρχεία, μοντέλα ή παρόχους
 * δεν εκτελείται ποτέ ως HTML. Δεν υπάρχουν inline styles (CSP style-src 'self'):
 * η εμφάνιση ορίζεται με κλάσεις και, όπου χρειάζεται τιμή, με CSS μεταβλητές.
 */

/**
 * h('button', { class: 'primary', onclick: fn, type: 'button' }, 'Κείμενο', child)
 * - class / dataset / aria-*: όπως στο HTML
 * - on<event>: listener
 * - boolean false / null / undefined: παραλείπεται
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props || {})) {
    if (value === false || value == null) continue;
    if (name === 'class') element.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (name === 'dataset') Object.assign(element.dataset, value);
    else if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value);
    else if (name === 'text') element.textContent = value;
    else if (name in element && !name.includes('-') && name !== 'list' && name !== 'form') element[name] = value;
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(element) {
  element.replaceChildren();
  return element;
}

/** Ορίζει CSS μεταβλητή σε στοιχείο (επιτρέπεται από την CSP, σε αντίθεση με style=""). */
export function setCssVar(element, name, value) {
  element.style.setProperty(name, value);
  return element;
}

/** Μοναδικό id για σύνδεση label ↔ input. */
let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Πεδίο με ετικέτα και προαιρετική βοήθεια. */
export function field(labelText, control, hint) {
  const id = control.id || uid('field');
  control.id = id;
  const hintNode = hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null;
  if (hintNode) control.setAttribute('aria-describedby', hintNode.id);
  return h('div', { class: 'field' }, h('label', { for: id }, labelText), control, hintNode);
}
