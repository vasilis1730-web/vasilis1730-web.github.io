/**
 * Οι διευθύνσεις API που καλεί η εφαρμογή (connect-src της CSP).
 * Κάθε host εδώ πρέπει να υπάρχει στο connect-src του public/_headers.
 */
export const ELEVENLABS_API = Object.freeze({
  speechToTextUrl: 'https://api.elevenlabs.io/v1/speech-to-text',
  /** Φθηνός έλεγχος κλειδιού: απαντά 200 με έγκυρο κλειδί, 401 με άκυρο. */
  userUrl: 'https://api.elevenlabs.io/v1/user',
  speechToTextModelId: 'scribe_v2',
  keyHeader: 'xi-api-key',
});
