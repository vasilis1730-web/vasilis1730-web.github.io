/**
 * Οι μορφές εξαγωγής (API-004): ένα κλειστό σύνολο τιμών, κοινό για τους
 * εξαγωγείς (infrastructure), την υπηρεσία εξαγωγής και τις ετικέτες της
 * διεπαφής.
 *
 * @typedef {typeof EXPORT_FORMATS[keyof typeof EXPORT_FORMATS]} ExportFormat
 */
export const EXPORT_FORMATS = Object.freeze({
  DOCX: 'docx',
  TXT: 'txt',
  SRT: 'srt',
  VTT: 'vtt',
  JSON: 'json',
});

/** Η σειρά προτίμησης για την κοινή χρήση: Word όπου επιτρέπεται, αλλιώς απλό κείμενο. */
export const SHARE_FORMAT_PREFERENCE = Object.freeze([EXPORT_FORMATS.DOCX, EXPORT_FORMATS.TXT]);
