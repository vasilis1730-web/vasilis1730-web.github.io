/**
 * Τα σταθερά ονόματα όσων σβήνει η «Διαγραφή όλων των δεδομένων» (CA-012):
 * το ίδιο σύνολο διαβάζουν η υπηρεσία διαγραφής (που ελέγχει ότι τα έχει
 * όλα), το composition root (που δίνει έναν στόχο για καθένα) και η διεπαφή
 * (που λέει στον χρήστη τι δεν σβήστηκε).
 *
 * @typedef {typeof ERASE_TARGETS[keyof typeof ERASE_TARGETS]} EraseTarget
 */
export const ERASE_TARGETS = Object.freeze({
  TRANSCRIPTS: 'transcripts',
  KEYS: 'keys',
  SETTINGS: 'settings',
  MODELS: 'models',
  SHARED_FILES: 'shared-files',
  SESSION_MEDIA: 'session-media',
});
