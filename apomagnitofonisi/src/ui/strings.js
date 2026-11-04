/**
 * Όλα τα κείμενα της διεπαφής (ελληνικά), σε ένα σημείο. Κανόνας: καμία άνω
 * τελεία, όπου χρειάζεται κόμμα ή τελεία. Οι συναρτήσεις παίρνουν τιμές που
 * αλλάζουν (αριθμούς, ονόματα). Οι αριθμοί (μεγέθη, τιμές) έρχονται από το
 * config, ώστε κάθε στοιχείο να έχει μία πηγή (CA-009).
 */
import { ERROR_CODES, INPUT_ISSUES } from '../application/errors.js';
import { PROGRESS_STAGES } from '../application/progress.js';
import { EXPORT_FORMATS } from '../application/export-formats.js';
import { ERASE_TARGETS } from '../application/erase-targets.js';
import { ENGINE_KINDS, SUMMARY_KINDS } from '../domain/transcript.js';
import { APP_NAME } from '../config/app-info.js';
import { AUTO_LOCAL_QUALITY, LOCAL_QUALITY_PRESET_IDS, smallestLocalDownloadMb, SPEAKER_EMBEDDING_MODEL, ELEVENLABS_SCRIBE_USD_PER_HOUR } from '../config/models.js';
import { formatPrice } from './number-format.js';

export const STRINGS = Object.freeze({
  appName: APP_NAME,
  tagline: 'Αρχεία ήχου και βίντεο σε κείμενο',
  nav: { home: 'Νέα μεταγραφή', history: 'Ιστορικό', settings: 'Ρυθμίσεις', main: 'Κύρια πλοήγηση' },
  footer: {
    independent: 'Ανεξάρτητη εφαρμογή, δεν συνδέεται με κανέναν δημόσιο φορέα.',
    privacy: 'Πολιτική απορρήτου',
  },
  common: {
    cancel: 'Ακύρωση',
    close: 'Κλείσιμο',
    confirm: 'Επιβεβαίωση',
    delete: 'Διαγραφή',
    save: 'Αποθήκευση',
    back: 'Πίσω',
    copy: 'Αντιγραφή',
    copied: 'Αντιγράφηκε.',
    share: 'Κοινή χρήση',
    retry: 'Ξανά',
    open: 'Άνοιγμα',
    rename: 'Μετονομασία',
    loading: 'Φόρτωση…',
    approximately: 'περίπου',
    notAvailable: 'μη διαθέσιμο',
  },
  update: { ready: 'Νέα έκδοση διαθέσιμη.', reload: 'Ανανέωση' },
  onboarding: {
    title: 'Καλώς ήρθατε',
    intro: 'Η εφαρμογή μετατρέπει ηχογραφήσεις και βίντεο σε κείμενο, με ομιλητές, χρόνους, υπότιτλους και Word.',
    local: `Στη συσκευή: δωρεάν και ιδιωτικά, ο ήχος δεν φεύγει από τη συσκευή. Την πρώτη φορά κατεβαίνει το μοντέλο (από ${smallestLocalDownloadMb()} MB).`,
    cloud: 'ElevenLabs: πολύ πιο ακριβής μεταγραφή και καλύτερος διαχωρισμός ομιλητών, με δικό σας κλειδί ElevenLabs.',
    summary: 'Περίληψη και πρακτικά: με δικό σας κλειδί Anthropic (Claude).',
    keys: 'Τα κλειδιά μένουν μόνο στη συσκευή σας και πηγαίνουν μόνο στον πάροχο που αφορούν.',
    dismiss: 'Κατάλαβα',
  },
  home: {
    title: 'Νέα μεταγραφή',
    dropHint: 'Σύρετε εδώ ένα αρχείο ήχου ή βίντεο',
    choose: 'Επιλογή αρχείου',
    formats: 'mp3, m4a, mp4, wav, ogg, opus, webm, flac, mov, mkv και άλλα',
    fileInfo: 'Αρχείο',
    probing: 'Ανάγνωση αρχείου…',
    noAudio: 'Το αρχείο δεν έχει ήχο.',
    engine: 'Πού να γίνει η μεταγραφή',
    engineUnavailable: 'Μη διαθέσιμο εδώ',
    goToSettings: 'Στις Ρυθμίσεις',
    language: 'Γλώσσα',
    autoLanguage: 'Αυτόματη ανίχνευση',
    diarize: 'Διαχωρισμός ομιλητών',
    speakers: 'Αριθμός ομιλητών',
    speakersAuto: 'Αυτόματα',
    quality: 'Ποιότητα στη συσκευή',
    webgpuYes: 'Η συσκευή έχει WebGPU: η μεταγραφή τρέχει στην κάρτα γραφικών.',
    webgpuNo: 'Η συσκευή δεν έχει WebGPU: η μεταγραφή τρέχει στον επεξεργαστή και είναι πιο αργή.',
    start: 'Έναρξη',
    jobRunning: 'Τρέχει ήδη μια μεταγραφή.',
    showJob: 'Δείτε την πρόοδο',
  },
  progress: {
    title: 'Μεταγραφή σε εξέλιξη',
    keepOpen: 'Κρατήστε την οθόνη ανοιχτή και την εφαρμογή μπροστά μέχρι να τελειώσει.',
    partial: 'Κείμενο μέχρι στιγμής',
    failedTitle: 'Η μεταγραφή δεν ολοκληρώθηκε',
    cancelledTitle: 'Η μεταγραφή ακυρώθηκε',
    newFile: 'Νέα μεταγραφή',
    stages: {
      [PROGRESS_STAGES.READING]: 'Ανάγνωση αρχείου',
      [PROGRESS_STAGES.DOWNLOADING_MODEL]: 'Λήψη μοντέλου (μόνο την πρώτη φορά)',
      [PROGRESS_STAGES.UPLOADING]: 'Αποστολή στο ElevenLabs',
      [PROGRESS_STAGES.TRANSCRIBING]: 'Μεταγραφή',
      [PROGRESS_STAGES.DIARIZING]: 'Διαχωρισμός ομιλητών',
      [PROGRESS_STAGES.SAVING]: 'Αποθήκευση',
    },
  },
  engines: {
    [ENGINE_KINDS.LOCAL]: {
      label: 'Στη συσκευή (δωρεάν, ιδιωτικά)',
      hint: 'Ο ήχος δεν φεύγει από τη συσκευή. Πιο αργό, μέτρια ακρίβεια στα ελληνικά.',
      short: 'Στη συσκευή',
      documentName: model => `Whisper στη συσκευή (${model})`,
      // Προαιρετική υπόδειξη κάτω από τον «Διαχωρισμό ομιλητών» (CA-008).
      diarizeHint: `Πειραματικό στη συσκευή: κατεβαίνει και μοντέλο φωνής (${SPEAKER_EMBEDDING_MODEL.approxDownloadMb} MB).`,
    },
    [ENGINE_KINDS.ELEVENLABS]: {
      label: 'ElevenLabs (ακριβέστερο, θέλει κλειδί)',
      hint: `Ο ήχος στέλνεται στο ElevenLabs με το κλειδί σας. Περίπου ${formatPrice(ELEVENLABS_SCRIBE_USD_PER_HOUR)} ανά ώρα ήχου.`,
      short: 'ElevenLabs',
      documentName: model => `ElevenLabs Scribe (${model})`,
    },
  },
  quality: {
    [AUTO_LOCAL_QUALITY]: 'Αυτόματα',
    [LOCAL_QUALITY_PRESET_IDS.FAST]: 'Γρήγορη',
    [LOCAL_QUALITY_PRESET_IDS.BALANCED]: 'Ισορροπημένη',
    [LOCAL_QUALITY_PRESET_IDS.ACCURATE]: 'Ακριβής',
    unavailable: 'θέλει WebGPU',
    autoResolves: label => `Αυτόματα (${label})`,
  },
  exportFormats: {
    [EXPORT_FORMATS.DOCX]: 'Word (.docx)',
    [EXPORT_FORMATS.TXT]: 'Κείμενο (.txt)',
    [EXPORT_FORMATS.SRT]: 'Υπότιτλοι (.srt)',
    [EXPORT_FORMATS.VTT]: 'Υπότιτλοι (.vtt)',
    [EXPORT_FORMATS.JSON]: 'Αντίγραφο (.json)',
  },
  audioEvents: {
    byEvent: {
      laughter: 'γέλια', laughs: 'γέλια', laughing: 'γέλια',
      applause: 'χειροκροτήματα', clapping: 'χειροκροτήματα',
      music: 'μουσική', cough: 'βήχας', coughing: 'βήχας', noise: 'θόρυβος', silence: 'σιωπή',
    },
    unknown: 'ήχος',
  },
  transcript: {
    titleLabel: 'Τίτλος',
    untitled: 'Μεταγραφή χωρίς τίτλο',
    speakers: 'Ομιλητές',
    renameSpeaker: 'Όνομα ομιλητή',
    addSpeaker: 'Νέος ομιλητής',
    newSpeakerName: 'Όνομα νέου ομιλητή',
    speakerOfSegment: 'Ομιλητής τμήματος',
    noSpeaker: 'Χωρίς ομιλητή',
    unknownSpeaker: 'Άγνωστος ομιλητής',
    search: 'Αναζήτηση στο κείμενο',
    noMatches: 'Δεν βρέθηκε.',
    audio: 'Ήχος',
    linkAudio: 'Σύνδεση με αρχείο ήχου',
    linkAudioHint: 'Επιλέξτε το ίδιο αρχείο για να ακούτε και να πηγαίνετε σε κάθε σημείο.',
    export: 'Εξαγωγή',
    summaries: 'Περίληψη και πρακτικά',
    editSegment: 'Διόρθωση κειμένου',
    playFrom: 'Αναπαραγωγή από',
    empty: 'Η μεταγραφή δεν έχει κείμενο. Ίσως το αρχείο έχει μόνο σιωπή ή μουσική.',
    notFound: 'Η μεταγραφή δεν βρέθηκε.',
    openFailed: 'Η μεταγραφή δεν άνοιξε.',
    talkTime: 'χρόνος ομιλίας',
    autoNotice: 'Αυτόματη μεταγραφή, μπορεί να έχει λάθη. Πατήστε σε ένα κείμενο για διόρθωση.',
  },
  summary: {
    title: 'Περίληψη και πρακτικά',
    kind: 'Τι να γραφτεί',
    kinds: {
      [SUMMARY_KINDS.BRIEF]: 'Σύντομη περίληψη',
      [SUMMARY_KINDS.MINUTES]: 'Πρακτικά συνεδρίασης',
      [SUMMARY_KINDS.ACTIONS]: 'Αποφάσεις και εκκρεμότητες',
      [SUMMARY_KINDS.CUSTOM]: 'Δική μου οδηγία',
    },
    fileSuffix: {
      [SUMMARY_KINDS.BRIEF]: 'Περίληψη',
      [SUMMARY_KINDS.MINUTES]: 'Πρακτικά',
      [SUMMARY_KINDS.ACTIONS]: 'Αποφάσεις',
      [SUMMARY_KINDS.CUSTOM]: 'Σημειώσεις',
    },
    customLabel: 'Η οδηγία σας',
    customPlaceholder: 'π.χ. Γράψε μόνο ό,τι αφορά τον προϋπολογισμό, σε λίστα.',
    model: 'Μοντέλο',
    cost: 'Εκτιμώμενο κόστος',
    costNote: 'Χρεώνεται στον λογαριασμό σας στην Anthropic.',
    generate: 'Σύνταξη',
    stop: 'Διακοπή',
    stopped: 'Η σύνταξη διακόπηκε, το κείμενο δεν αποθηκεύτηκε.',
    writing: 'Γράφεται…',
    restarted: 'Το κείμενο ξαναγράφεται από εφεδρικό μοντέλο.',
    restartedDone: 'Το κείμενο γράφτηκε από εφεδρικό μοντέλο, γιατί το πρώτο αρνήθηκε.',
    truncated: 'Το κείμενο κόπηκε στο όριο μήκους.',
    saved: 'Αποθηκευμένα',
    none: 'Δεν υπάρχει ακόμη περίληψη.',
    noKey: 'Βάλτε πρώτα κλειδί Anthropic στις Ρυθμίσεις.',
    notice: 'Συντάχθηκε αυτόματα με Claude από τη μεταγραφή. Ελέγξτε το πριν το χρησιμοποιήσετε.',
    deleteConfirm: 'Να διαγραφεί αυτή η περίληψη;',
    backToTranscript: 'Πίσω στη μεταγραφή',
  },
  history: {
    title: 'Ιστορικό',
    empty: 'Δεν υπάρχουν αποθηκευμένες μεταγραφές.',
    storage: 'Χώρος στη συσκευή',
    import: 'Εισαγωγή από .json',
    imported: 'Η μεταγραφή εισήχθη.',
    deleteAll: 'Διαγραφή όλων',
    deleteAllConfirm: 'Να διαγραφούν όλες οι μεταγραφές από αυτή τη συσκευή; Δεν αναιρείται.',
    deleteConfirm: 'Να διαγραφεί αυτή η μεταγραφή; Δεν αναιρείται.',
    segments: 'τμήματα',
    summariesCount: 'περιλήψεις',
    deleted: 'Η μεταγραφή διαγράφηκε.',
    allDeleted: 'Όλες οι μεταγραφές διαγράφηκαν.',
  },
  settings: {
    title: 'Ρυθμίσεις',
    keysTitle: 'Κλειδιά API',
    keysIntro: 'Η εφαρμογή δεν έχει δικό της server. Κάθε κλειδί μένει στη συσκευή σας και πηγαίνει μόνο στον πάροχο που αφορά.',
    elevenLabsKey: 'Κλειδί ElevenLabs',
    elevenLabsHelp: 'Δημιουργία λογαριασμού στο elevenlabs.io, μετά Developers, API Keys, Create. Αρκεί το δικαίωμα Speech to Text.',
    anthropicKey: 'Κλειδί Anthropic (Claude)',
    anthropicHelp: 'Δημιουργία λογαριασμού στο console.anthropic.com, μετά API Keys, Create Key. Χρειάζεται υπόλοιπο στον λογαριασμό.',
    getKey: 'Πού βρίσκω κλειδί',
    pricing: 'Τιμές',
    keyPlaceholder: 'Επικόλληση κλειδιού',
    keySaved: 'Το κλειδί αποθηκεύτηκε.',
    keyRemoved: 'Το κλειδί αφαιρέθηκε.',
    keyValid: 'Το κλειδί είναι έγκυρο.',
    keyStored: 'Αποθηκευμένο κλειδί που τελειώνει σε',
    verify: 'Έλεγχος κλειδιού',
    verifying: 'Έλεγχος…',
    show: 'Εμφάνιση',
    hide: 'Απόκρυψη',
    remove: 'Αφαίρεση',
    keyRetentionDevice: 'Αποθήκευση των κλειδιών στη συσκευή',
    keyRetentionHint: 'Αν το κλείσετε, τα κλειδιά ισχύουν μόνο μέχρι να κλείσει η καρτέλα.',
    claudeModel: 'Μοντέλο για περίληψη και πρακτικά',
    claudeModelDefault: 'προεπιλογή',
    perMillion: 'ανά εκατομμύριο tokens (είσοδος/έξοδος)',
    localQuality: 'Ποιότητα μεταγραφής στη συσκευή',
    textTitle: 'Κείμενο',
    noAnoTeleia: 'Χωρίς άνω τελεία',
    noAnoTeleiaHint: 'Η άνω τελεία γίνεται κόμμα ή τελεία, ανάλογα με τη σύνταξη.',
    modelsTitle: 'Μοντέλα στη συσκευή',
    modelsSize: 'Χώρος μοντέλων',
    deleteModels: 'Διαγραφή μοντέλων',
    deleteModelsConfirm: 'Να διαγραφούν τα μοντέλα από τη συσκευή; Αν τρέχει μεταγραφή, θα σταματήσει.',
    modelsDeleted: 'Τα μοντέλα διαγράφηκαν. Θα ξανακατέβουν όταν χρειαστούν.',
    dataTitle: 'Δεδομένα',
    deleteEverything: 'Διαγραφή όλων των δεδομένων',
    deleteEverythingConfirm: 'Να διαγραφούν όλες οι μεταγραφές, τα κλειδιά, οι ρυθμίσεις και τα μοντέλα από αυτή τη συσκευή; Αν τρέχει μεταγραφή, θα σταματήσει. Δεν αναιρείται.',
    everythingDeleted: 'Όλα τα δεδομένα διαγράφηκαν από τη συσκευή.',
    eraseTargets: {
      [ERASE_TARGETS.TRANSCRIPTS]: 'μεταγραφές',
      [ERASE_TARGETS.KEYS]: 'κλειδιά',
      [ERASE_TARGETS.SETTINGS]: 'ρυθμίσεις',
      [ERASE_TARGETS.MODELS]: 'μοντέλα',
      [ERASE_TARGETS.SHARED_FILES]: 'αρχεία από κοινή χρήση',
      [ERASE_TARGETS.SESSION_MEDIA]: 'αρχεία της συνεδρίας',
    },
    about: 'Σχετικά',
    version: 'Έκδοση',
  },
  errors: {
    [ERROR_CODES.KEY_MISSING]: 'Λείπει το κλειδί API. Προσθέστε το στις Ρυθμίσεις.',
    [ERROR_CODES.KEY_INVALID]: 'Το κλειδί API δεν είναι έγκυρο ή δεν έχει τα απαραίτητα δικαιώματα.',
    [ERROR_CODES.QUOTA_EXCEEDED]: 'Εξαντλήθηκε το υπόλοιπο ή το όριο χρήσης του λογαριασμού σας στον πάροχο.',
    [ERROR_CODES.RATE_LIMITED]: 'Πολλά αιτήματα σε λίγο χρόνο. Δοκιμάστε ξανά σε λίγο.',
    [ERROR_CODES.OVERLOADED]: 'Ο πάροχος είναι προσωρινά υπερφορτωμένος. Δοκιμάστε ξανά σε λίγο.',
    [ERROR_CODES.FILE_TOO_LARGE]: 'Το αρχείο είναι πολύ μεγάλο για τον πάροχο.',
    [ERROR_CODES.UNSUPPORTED_MEDIA]: 'Η μορφή του αρχείου δεν υποστηρίζεται σε αυτόν τον browser. Δοκιμάστε mp3, m4a ή wav.',
    [ERROR_CODES.NO_AUDIO_TRACK]: 'Το αρχείο δεν έχει ήχο.',
    [ERROR_CODES.NETWORK]: 'Δεν υπάρχει σύνδεση στο διαδίκτυο ή ο πάροχος δεν απαντά.',
    [ERROR_CODES.CANCELLED]: 'Ακυρώθηκε.',
    [ERROR_CODES.MODEL_LOAD_FAILED]: 'Το μοντέλο δεν φόρτωσε. Ελέγξτε τη σύνδεση και τον ελεύθερο χώρο, και δοκιμάστε ξανά.',
    [ERROR_CODES.TRANSCRIPTION_FAILED]: 'Η μεταγραφή στη συσκευή σταμάτησε (ίσως από έλλειψη μνήμης). Δοκιμάστε μικρότερη ποιότητα ή το ElevenLabs.',
    [ERROR_CODES.DEVICE_UNSUPPORTED]: 'Η συσκευή ή ο browser δεν υποστηρίζει αυτή τη λειτουργία. Δοκιμάστε άλλη ποιότητα ή το ElevenLabs.',
    [ERROR_CODES.REFUSED]: 'Το μοντέλο αρνήθηκε να απαντήσει σε αυτό το περιεχόμενο.',
    [ERROR_CODES.PROVIDER_REJECTED]: 'Ο πάροχος απέρριψε το αίτημα.',
    [ERROR_CODES.INVALID_INPUT]: 'Ελέγξτε τα στοιχεία που δώσατε.',
    [ERROR_CODES.INVALID_TRANSCRIPT_FILE]: 'Το αρχείο δεν είναι αντίγραφο μεταγραφής αυτής της εφαρμογής (.json).',
    [ERROR_CODES.EMPTY_TRANSCRIPT]: 'Η μεταγραφή δεν έχει κείμενο.',
    [ERROR_CODES.NOT_FOUND]: 'Δεν βρέθηκε.',
    [ERROR_CODES.STORAGE_FULL]: 'Δεν υπάρχει αρκετός χώρος στη συσκευή.',
    [ERROR_CODES.ERASE_INCOMPLETE]: 'Δεν διαγράφηκαν όλα τα δεδομένα. Κλείστε τις άλλες καρτέλες της εφαρμογής και δοκιμάστε ξανά.',
    [ERROR_CODES.UNKNOWN]: 'Κάτι πήγε στραβά.',
    providerSaid: 'Μήνυμα παρόχου',
    notErased: 'Έμειναν',
  },
  inputIssues: {
    [INPUT_ISSUES.EMPTY_KEY]: 'Επικολλήστε πρώτα το κλειδί.',
    [INPUT_ISSUES.KEY_WHITESPACE]: 'Το κλειδί δεν πρέπει να έχει κενά. Ελέγξτε την επικόλληση.',
    [INPUT_ISSUES.EMPTY_SPEAKER_NAME]: 'Το όνομα ομιλητή δεν μπορεί να είναι κενό.',
    [INPUT_ISSUES.EMPTY_INSTRUCTION]: 'Γράψτε πρώτα την οδηγία σας.',
    [INPUT_ISSUES.EMPTY_FILE]: 'Το αρχείο είναι κενό.',
  },
  documents: {
    date: 'Ημερομηνία',
    duration: 'Διάρκεια',
    engine: 'Μεταγραφή',
    transcriptNotice: 'Αυτόματη μεταγραφή, μπορεί να έχει λάθη.',
  },
  units: { bytes: 'B', kb: 'KB', mb: 'MB', gb: 'GB' },
});

/** «Ομιλητής 3»: η μία ονομασία για τους ομιλητές σε όλα τα στρώματα (API-008). */
export const speakerLabelFor = ordinal => `Ομιλητής ${ordinal}`;

const KNOWN_ERROR_CODES = new Set(Object.values(ERROR_CODES));

/**
 * Το μήνυμα ενός κωδικού σφάλματος, και για το INVALID_INPUT της αιτίας του
 * (API-001, API-020), π.χ. για τον λόγο που μια μηχανή δεν είναι διαθέσιμη.
 * Άγνωστος κωδικός → «Κάτι πήγε στραβά».
 * @param {import('../application/errors.js').ErrorCode|string|null|undefined} code
 * @param {string} [reason]  αιτία του INVALID_INPUT (INPUT_ISSUES)
 */
export function messageForCode(code, reason) {
  if (code === ERROR_CODES.INVALID_INPUT && reason && STRINGS.inputIssues[reason]) return STRINGS.inputIssues[reason];
  return KNOWN_ERROR_CODES.has(code) ? STRINGS.errors[code] : STRINGS.errors[ERROR_CODES.UNKNOWN];
}

/**
 * Μήνυμα για τον χρήστη από σφάλμα: ο κωδικός του AppError (και η αιτία του).
 * Ό,τι δεν είναι AppError (λάθος του κώδικα) → «Κάτι πήγε στραβά».
 */
export function errorMessage(error) {
  if (!error || typeof error.code !== 'string') return messageForCode(ERROR_CODES.UNKNOWN);
  return messageForCode(error.code, error.details && error.details.reason);
}

/** Η ετικέτα μιας μορφής εξαγωγής, π.χ. «Word (.docx)» (OO-007). */
export function exportFormatLabel(format) {
  return STRINGS.exportFormats[format] || format;
}

/** Η ετικέτα ενός επιπέδου ποιότητας ή του «Αυτόματα». */
export function qualityLabel(choice) {
  return STRINGS.quality[choice] || choice;
}

export function providerMessage(error) {
  return error && error.details && error.details.providerMessage ? String(error.details.providerMessage) : null;
}

/** «Περίπου 410 MB λήψη την πρώτη φορά» */
export const downloadSizeHint = mb => `περίπου ${mb} MB λήψη την πρώτη φορά`;

/** «12 τμήματα, 2 περιλήψεις» */
export const historyCounts = (segments, summaries) => `${segments} ${STRINGS.history.segments}, ${summaries} ${STRINGS.history.summariesCount}`;

/** «Βρέθηκαν 3» */
export const matchesFound = n => `Βρέθηκαν ${n}`;
