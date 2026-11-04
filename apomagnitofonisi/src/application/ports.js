/**
 * Οι θύρες (ports) της εφαρμογής: τα συμβόλαια που υλοποιούν οι adapters
 * του infrastructure και που καταναλώνουν οι υπηρεσίες και η διεπαφή. Το
 * αρχείο έχει μόνο τύπους (JSDoc) και κανέναν κώδικα. Οι υπηρεσίες και οι
 * προβολές εξαρτώνται από αυτά τα συμβόλαια και ποτέ από συγκεκριμένο adapter
 * (CA-001, OO-008). Τη σύνδεση την κάνει μόνο το src/main.js (composition root).
 *
 * --------------------------------------------------------------- Μεταγραφή
 *
 * @typedef {import('../domain/transcript.js').Transcript} Transcript
 * @typedef {import('../domain/transcript.js').Summary} Summary
 * @typedef {import('../domain/transcript.js').EngineKind} EngineKind
 * @typedef {import('../domain/transcript.js').TranscriptEngineInfo} TranscriptEngineInfo
 * @typedef {import('../domain/words-to-segments.js').RecognizedSegment} RecognizedSegment
 * @typedef {import('../config/models.js').LocalQualityPresetId} LocalQualityPresetId
 * @typedef {import('../config/models.js').LocalQualityChoice} LocalQualityChoice
 * @typedef {import('./progress.js').ProgressUpdate} ProgressUpdate
 * @typedef {import('./errors.js').ErrorCode} ErrorCode
 *
 * @typedef {Object} RecognitionOptions
 * @property {string} languageCode  'auto' ή ISO 639-1
 * @property {boolean} diarize  διαχωρισμός ομιλητών
 * @property {number|null} expectedSpeakers  γνωστό πλήθος ομιλητών ή null (αυτόματα)
 * @property {LocalQualityChoice} [localQualityPreset]  μόνο για τη μηχανή στη συσκευή
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
 * @property {ErrorCode} [reason]  γιατί δεν είναι διαθέσιμη (π.χ. KEY_MISSING)
 *
 * @typedef {Object} QualityPresetOption
 * @property {LocalQualityPresetId} id
 * @property {boolean} available  τρέχει σε αυτή τη συσκευή
 * @property {number|null} approxDownloadMb  λήψη την πρώτη φορά, null όταν δεν τρέχει
 *
 * @typedef {Object} QualityPresetsDescription  τα επίπεδα ποιότητας μιας μηχανής σε αυτή τη συσκευή
 * @property {boolean} accelerated  η μεταγραφή τρέχει στην κάρτα γραφικών (WebGPU)
 * @property {LocalQualityPresetId} autoPresetId  ποιο επίπεδο διαλέγει το «Αυτόματα»
 * @property {QualityPresetOption[]} presets
 *
 * @typedef {Object} TranscriptionEngine
 * @property {EngineKind} kind
 * @property {(options?: RecognitionOptions) => Promise<EngineAvailability>} checkAvailability
 * @property {(request: RecognitionRequest) => Promise<RecognitionResult>} recognize
 * @property {() => Promise<QualityPresetsDescription>} [describeQualityPresets]  μόνο μηχανές με επίπεδα ποιότητας
 *
 * --------------------------------------------------------------- Αρχεία ήχου και βίντεο
 *
 * @typedef {Object} MediaInfo
 * @property {number|null} durationSec
 * @property {boolean} hasAudio
 * @property {boolean} hasVideo
 * @property {string|null} audioCodec
 *
 * @typedef {Object} CompactAudio
 * @property {Blob} audio  το αρχείο για αποστολή
 * @property {boolean} compacted  false: δεν έγινε συμπίεση και το audio είναι το αρχικό αρχείο
 *
 * @typedef {Object} MediaReader
 * @property {(media: Blob) => Promise<MediaInfo>} probe
 * @property {(media: Blob, options?: { signal?: AbortSignal }) => AsyncIterable<Float32Array>} readMono16k
 *   PCM με συχνότητα PCM_SAMPLE_RATE (domain/audio/pcm.js, 16 kHz), ένα κανάλι, σε διαδοχικά κομμάτια
 * @property {(media: Blob, options?: { signal?: AbortSignal, onFraction?: (fraction: number) => void }) => Promise<CompactAudio>} extractCompactAudio
 *   μόνο ο ήχος, συμπιεσμένος για αποστολή. Πετά σφάλμα όταν το αρχείο δεν διαβάζεται.
 *
 * --------------------------------------------------------------- Περίληψη
 *
 * @typedef {Object} SummaryRequest
 * @property {string} systemPrompt
 * @property {string} transcriptText  η μεταγραφή ως γραμμές «[hh:mm:ss] Όνομα: κείμενο»
 * @property {string} instruction  τι να γράψει το μοντέλο
 * @property {string} modelId  π.χ. claude-opus-5-5
 * @property {AbortSignal} [signal]
 * @property {(delta: string) => void} [onText]  κείμενο όσο γράφεται
 * @property {() => void} [onRestart]  το μοντέλο ξεκίνησε από την αρχή (εφεδρικό μοντέλο), το κείμενο ως τώρα δεν ισχύει
 *
 * @typedef {Object} SummaryResult
 * @property {string} text  Markdown
 * @property {string} modelId  το μοντέλο που απάντησε τελικά
 * @property {boolean} truncated  σταμάτησε στο όριο μήκους
 * @property {boolean} restarted  ξαναγράφτηκε από εφεδρικό μοντέλο
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
 * @property {() => Promise<void>} clear  διαγραφή όλων
 *
 * @typedef {Object} SettingsStore
 * @property {() => Record<string, unknown>|null} load
 * @property {(settings: Record<string, unknown>) => void} save
 * @property {() => void} clear
 *
 * @typedef {import('./api-key-service.js').KeyProvider} KeyProvider
 * @typedef {'device'|'session'} KeyRetention  στη συσκευή ή μόνο για την καρτέλα
 *
 * @typedef {Object} KeyStore  τα κλειδιά API του χρήστη, μόνο στη συσκευή του
 * @property {(provider: KeyProvider) => string|null} getKey
 * @property {(provider: KeyProvider, key: string) => void} setKey
 * @property {(provider: KeyProvider) => void} removeKey
 * @property {(retention: KeyRetention) => void} setKeyRetention
 * @property {() => KeyRetention} keyRetention
 * @property {() => void} clear  διαγραφή όλων των κλειδιών και της επιλογής διατήρησης
 *
 * @typedef {Object} KeyVerifier
 * @property {KeyProvider} provider
 * @property {(key: string) => Promise<void>} verify  πετά AppError KEY_INVALID, NETWORK κ.λπ.
 *
 * @typedef {Object} StorageUsage
 * @property {number|null} usageBytes
 * @property {number|null} quotaBytes
 *
 * @typedef {Object} DeviceStorage  ο χώρος της εφαρμογής στη συσκευή
 * @property {() => Promise<StorageUsage>} estimateUsage
 * @property {() => Promise<boolean>} requestPersistence  να μη σβήνει ο browser τα δεδομένα
 *
 * @typedef {Object} ModelCache  τα μοντέλα που κατέβηκαν στη συσκευή
 * @property {() => Promise<number|null>} estimateSizeBytes
 * @property {() => Promise<void>} clear
 *
 * @typedef {Object} SharedFileInbox  αρχεία που έστειλαν άλλες εφαρμογές με «Κοινή χρήση»
 * @property {() => Promise<File[]>} takeFiles  τα αρχεία που περίμεναν (και σβήνονται)
 * @property {() => Promise<void>} clear
 *
 * @typedef {Object} Erasable  ό,τι σβήνει η «Διαγραφή όλων των δεδομένων»
 * @property {string} name  σταθερό όνομα (ERASE_TARGETS), για το μήνυμα όταν αποτύχει
 * @property {() => Promise<void>|void} erase
 *
 * --------------------------------------------------------------- Εξαγωγή και παράδοση αρχείων
 *
 * @typedef {import('./export-formats.js').ExportFormat} ExportFormat
 *
 * @typedef {Object} ExportFile
 * @property {string} fileName  με κενά, ποτέ με κάτω παύλες
 * @property {string} mimeType
 * @property {Uint8Array|string} data
 *
 * @typedef {Object} TranscriptExporter
 * @property {ExportFormat} format
 * @property {string} extension
 * @property {string} mimeType
 * @property {(transcript: Transcript) => Uint8Array|string} render
 *
 * @typedef {Object} SummaryExporter
 * @property {ExportFormat} format
 * @property {string} extension
 * @property {string} mimeType
 * @property {(transcript: Transcript, summary: Summary) => Uint8Array|string} render
 *
 * @typedef {Object} ExportLabels  τα κείμενα των εγγράφων, από τη διεπαφή
 * @property {string} appName
 * @property {string} date
 * @property {string} duration
 * @property {string} speakers
 * @property {string} engine
 * @property {string} unknownSpeaker
 * @property {string} untitled  όταν η μεταγραφή δεν έχει τίτλο
 * @property {string} transcriptNotice  π.χ. «Αυτόματη μεταγραφή, μπορεί να έχει λάθη.»
 * @property {string} summaryNotice  π.χ. «Συντάχθηκε αυτόματα με Claude από τη μεταγραφή.»
 * @property {(iso: string) => string} formatDate
 * @property {(engine: TranscriptEngineInfo) => string} describeEngine
 * @property {(kind: string) => string} summaryTitleFor  π.χ. 'minutes' → «Πρακτικά συνεδρίασης»
 *
 * @typedef {Object} FileMetadata
 * @property {string} fileName
 * @property {string} mimeType
 *
 * @typedef {Object} FileDelivery  παράδοση αρχείων στον χρήστη
 * @property {(file: ExportFile) => void} download
 * @property {(file: FileMetadata) => boolean} canShare  αν η συσκευή μοιράζεται αρχεία αυτού του ονόματος και τύπου
 * @property {(file: ExportFile, title: string) => Promise<void>} share  πετά AppError CANCELLED όταν ακυρώσει ο χρήστης
 *
 * @typedef {Object} Clipboard
 * @property {(text: string) => Promise<void>} copyText
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
