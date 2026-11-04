/**
 * Οι θύρες (ports) του application: τα συμβόλαια που υλοποιούν οι adapters
 * του infrastructure και που καταναλώνουν οι υπηρεσίες. Το αρχείο έχει μόνο
 * τύπους (JSDoc) και κανέναν κώδικα. Οι υπηρεσίες εξαρτώνται από αυτά τα
 * συμβόλαια και ποτέ από συγκεκριμένο adapter. Τη σύνδεση την κάνει μόνο το
 * src/main.js (composition root).
 *
 * --------------------------------------------------------------- Μεταγραφή
 *
 * @typedef {import('../domain/transcript.js').Transcript} Transcript
 * @typedef {import('../domain/transcript.js').EngineKind} EngineKind
 * @typedef {import('../domain/words-to-segments.js').RecognizedSegment} RecognizedSegment
 * @typedef {import('./progress.js').ProgressUpdate} ProgressUpdate
 *
 * @typedef {Object} RecognitionOptions
 * @property {string} languageCode  'auto' ή ISO 639-1
 * @property {boolean} diarize  διαχωρισμός ομιλητών
 * @property {number|null} expectedSpeakers  γνωστό πλήθος ομιλητών ή null (αυτόματα)
 * @property {string} [qualityPreset]  μόνο για τη μηχανή στη συσκευή
 *
 * @typedef {Object} RecognitionRequest
 * @property {Blob} media  το αρχείο (File) του χρήστη
 * @property {RecognitionOptions} options
 * @property {AbortSignal} [signal]
 * @property {(update: ProgressUpdate) => void} [onProgress]
 * @property {(segments: RecognizedSegment[]) => void} [onPartialSegments]  νέα τμήματα όσο προχωρά
 *
 * @typedef {Object} RecognitionResult
 * @property {RecognizedSegment[]} segments  ταξινομημένα κατά χρόνο
 * @property {string|null} languageCode  η γλώσσα που αναγνωρίστηκε ή ζητήθηκε (ISO 639-1)
 * @property {number|null} durationSec
 * @property {string} model  το μοντέλο που έκανε τη μεταγραφή
 *
 * @typedef {Object} EngineAvailability
 * @property {boolean} available
 * @property {string} [reason]  κωδικός ERROR_CODES όταν δεν είναι διαθέσιμη
 *
 * @typedef {Object} TranscriptionEngine
 * @property {EngineKind} kind
 * @property {(options?: RecognitionOptions) => Promise<EngineAvailability>} checkAvailability
 * @property {(request: RecognitionRequest) => Promise<RecognitionResult>} recognize
 *
 * --------------------------------------------------------------- Αρχεία ήχου και βίντεο
 *
 * @typedef {Object} MediaInfo
 * @property {number|null} durationSec
 * @property {boolean} hasAudio
 * @property {boolean} hasVideo
 * @property {string|null} audioCodec
 *
 * @typedef {Object} MediaReader
 * @property {(media: Blob) => Promise<MediaInfo>} probe
 * @property {(media: Blob, options?: { signal?: AbortSignal }) => AsyncIterable<Float32Array>} readMono16k
 *   PCM 16 kHz, ένα κανάλι, σε διαδοχικά κομμάτια
 * @property {(media: Blob, options?: { signal?: AbortSignal, onProgress?: (fraction: number) => void }) => Promise<Blob>} extractCompactAudio
 *   μόνο ο ήχος, συμπιεσμένος για αποστολή (ή το ίδιο αρχείο όταν δεν γίνεται)
 *
 * --------------------------------------------------------------- Περίληψη
 *
 * @typedef {Object} SummaryRequest
 * @property {string} systemPrompt
 * @property {string} transcriptText  η μεταγραφή ως γραμμές «[hh:mm:ss] Όνομα: κείμενο»
 * @property {string} instruction  τι να γράψει το μοντέλο
 * @property {string} model
 * @property {AbortSignal} [signal]
 * @property {(delta: string) => void} [onText]  κείμενο όσο γράφεται
 * @property {() => void} [onRestart]  το μοντέλο ξεκίνησε από την αρχή (εφεδρικό μοντέλο), το κείμενο ως τώρα δεν ισχύει
 *
 * @typedef {Object} SummaryResult
 * @property {string} text  Markdown
 * @property {string} model  το μοντέλο που απάντησε τελικά
 * @property {boolean} truncated  σταμάτησε στο όριο μήκους
 *
 * @typedef {Object} Summarizer
 * @property {(request: SummaryRequest) => Promise<SummaryResult>} summarize
 *
 * --------------------------------------------------------------- Αποθήκευση
 *
 * @typedef {Object} TranscriptListItem
 * @property {string} id
 * @property {string} title
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number|null} durationSec
 * @property {EngineKind} engineKind
 * @property {number} segmentCount
 * @property {number} summaryCount
 *
 * @typedef {Object} TranscriptRepository
 * @property {(transcript: Transcript) => Promise<void>} save
 * @property {(id: string) => Promise<Transcript|null>} findById
 * @property {() => Promise<TranscriptListItem[]>} listNewestFirst
 * @property {(id: string) => Promise<void>} remove
 * @property {() => Promise<void>} removeAll
 *
 * @typedef {Object} SettingsStore
 * @property {() => Record<string, unknown>|null} load
 * @property {(settings: Record<string, unknown>) => void} save
 * @property {() => void} clear
 *
 * @typedef {'elevenlabs'|'anthropic'} KeyProvider
 *
 * @typedef {Object} KeyStore  τα κλειδιά API του χρήστη, μόνο στη συσκευή του
 * @property {(provider: KeyProvider) => string|null} getKey
 * @property {(provider: KeyProvider, key: string) => void} setKey
 * @property {(provider: KeyProvider) => void} removeKey
 * @property {(persistent: boolean) => void} setPersistent  true: μένουν στη συσκευή, false: μόνο για την καρτέλα
 * @property {() => boolean} isPersistent
 * @property {() => void} clearAll
 *
 * @typedef {Object} KeyVerifier
 * @property {KeyProvider} provider
 * @property {(key: string) => Promise<void>} verify  πετά AppError KEY_INVALID, NETWORK κ.λπ.
 *
 * @typedef {Object} StorageUsage
 * @property {number|null} usageBytes
 * @property {number|null} quotaBytes
 *
 * @typedef {Object} StorageEstimator
 * @property {() => Promise<StorageUsage>} estimate
 * @property {() => Promise<boolean>} requestPersistence
 *
 * --------------------------------------------------------------- Εξαγωγή
 *
 * @typedef {Object} ExportFile
 * @property {string} fileName  με κενά, ποτέ με κάτω παύλες
 * @property {string} mimeType
 * @property {Uint8Array|string} data
 *
 * @typedef {Object} TranscriptExporter
 * @property {string} format  π.χ. 'docx', 'srt'
 * @property {string} extension
 * @property {string} mimeType
 * @property {(transcript: Transcript) => Uint8Array|string} render
 *
 * @typedef {Object} SummaryExporter
 * @property {string} format
 * @property {string} extension
 * @property {string} mimeType
 * @property {(transcript: Transcript, summary: import('../domain/transcript.js').Summary) => Uint8Array|string} render
 *
 * --------------------------------------------------------------- Χρόνος και αναγνωριστικά
 *
 * @typedef {Object} Clock
 * @property {() => string} nowIso
 *
 * @typedef {Object} IdGenerator
 * @property {() => string} newId
 */
export {};
