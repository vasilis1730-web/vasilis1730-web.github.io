/**
 * Οι γλώσσες μεταγραφής. Κάθε γλώσσα έχει τον κωδικό ISO 639-1 (που δέχεται
 * και το ElevenLabs), το ISO 639-3 (που επιστρέφει το ElevenLabs) και το
 * όνομα που περιμένει το Whisper.
 */
export const AUTO_LANGUAGE_CODE = 'auto';

export const DEFAULT_LANGUAGE_CODE = 'el';

export const LANGUAGES = Object.freeze([
  { code: 'el', iso6393: 'ell', whisperName: 'greek', label: 'Ελληνικά' },
  { code: 'en', iso6393: 'eng', whisperName: 'english', label: 'English' },
  { code: 'de', iso6393: 'deu', whisperName: 'german', label: 'Deutsch' },
  { code: 'fr', iso6393: 'fra', whisperName: 'french', label: 'Français' },
  { code: 'it', iso6393: 'ita', whisperName: 'italian', label: 'Italiano' },
  { code: 'es', iso6393: 'spa', whisperName: 'spanish', label: 'Español' },
  { code: 'tr', iso6393: 'tur', whisperName: 'turkish', label: 'Türkçe' },
  { code: 'ru', iso6393: 'rus', whisperName: 'russian', label: 'Русский' },
  { code: 'bg', iso6393: 'bul', whisperName: 'bulgarian', label: 'Български' },
  { code: 'ro', iso6393: 'ron', whisperName: 'romanian', label: 'Română' },
  { code: 'sq', iso6393: 'sqi', whisperName: 'albanian', label: 'Shqip' },
  { code: 'ar', iso6393: 'ara', whisperName: 'arabic', label: 'العربية' },
].map(Object.freeze));

/** Η γλώσσα με κωδικό ISO 639-1 ή ISO 639-3, ή null. */
export function findLanguage(code) {
  if (typeof code !== 'string') return null;
  const wanted = code.trim().toLowerCase();
  return LANGUAGES.find(l => l.code === wanted || l.iso6393 === wanted) || null;
}

export function isSupportedLanguageCode(code) {
  return code === AUTO_LANGUAGE_CODE || LANGUAGES.some(l => l.code === code);
}

/** Ο κωδικός ISO 639-1 όταν ο χρήστης διάλεξε γλώσσα, ή null για «Αυτόματη ανίχνευση» (OO-009). */
export function explicitLanguageCode(code) {
  return code && code !== AUTO_LANGUAGE_CODE ? code : null;
}

/** Το όνομα γλώσσας του Whisper (π.χ. 'greek'), ή null για αυτόματη ανίχνευση ή άγνωστη γλώσσα. */
export function whisperLanguageFor(code) {
  const language = findLanguage(explicitLanguageCode(code));
  return language ? language.whisperName : null;
}
