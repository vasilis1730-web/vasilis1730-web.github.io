/**
 * Τα κλειστά σύνολα τιμών για τα κλειδιά API του χρήστη (CA-012): ποιοι
 * πάροχοι έχουν κλειδί και πού μένουν τα κλειδιά. Μόνο σταθερές, χωρίς
 * εξαρτήσεις, ώστε να τις διαβάζουν οι θύρες (ports.js), οι υπηρεσίες, οι
 * adapters και η διεπαφή χωρίς να εξαρτώνται από κάποια υπηρεσία.
 *
 * @typedef {typeof KEY_PROVIDERS[keyof typeof KEY_PROVIDERS]} KeyProvider
 * @typedef {typeof KEY_RETENTIONS[keyof typeof KEY_RETENTIONS]} KeyRetention
 */

/** Οι πάροχοι κλειδιών (API-004): ένα κλειστό σύνολο, ποτέ ελεύθερα strings. */
export const KEY_PROVIDERS = Object.freeze({
  ELEVENLABS: 'elevenlabs',
  ANTHROPIC: 'anthropic',
});

/** Πού μένουν τα κλειδιά: στη συσκευή ή μόνο όσο είναι ανοιχτή η καρτέλα. */
export const KEY_RETENTIONS = Object.freeze({
  DEVICE: 'device',
  SESSION: 'session',
});
