/**
 * Ονόματα αρχείων για ό,τι κατεβάζει ο χρήστης (Word, υπότιτλοι, κείμενο).
 *
 * Κανόνας: κενά ανάμεσα στις λέξεις, ποτέ κάτω παύλες. Επιτρέπονται ελληνικά
 * και κάθε χαρακτήρας που δέχονται τα Windows, το Android και το macOS. Οι
 * απαγορευμένοι χαρακτήρες (\ / : * ? " < > |) και οι χαρακτήρες ελέγχου
 * φεύγουν, τα δεσμευμένα ονόματα των Windows (CON, NUL, COM1 …) παίρνουν
 * κατάληξη, και το όνομα δεν ξεπερνά τους 120 χαρακτήρες.
 */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const DEFAULT_BASE_NAME = 'Απομαγνητοφώνηση';

/**
 * @param {string} baseName  π.χ. ο τίτλος της μεταγραφής
 * @param {string} extension  π.χ. 'docx' (με ή χωρίς τελεία)
 * @param {{ maxLength?: number, fallback?: string }} [options]
 */
export function toSafeFileName(baseName, extension, { maxLength = 120, fallback = DEFAULT_BASE_NAME } = {}) {
  const ext = String(extension || '').replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let name = cleanPart(baseName);
  if (!name) name = cleanPart(fallback) || DEFAULT_BASE_NAME;
  if (RESERVED.test(name)) name = `${name} 1`;
  name = truncateCodePoints(name, maxLength).replace(/[ .]+$/, '');
  return ext ? `${name}.${ext}` : name;
}

function cleanPart(value) {
  return String(value ?? '')
    .replace(FORBIDDEN, ' ')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');
}

function truncateCodePoints(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('').trim();
}
