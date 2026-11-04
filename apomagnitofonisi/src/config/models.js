/**
 * Τα μοντέλα της εφαρμογής: Whisper στη συσκευή, αποτύπωμα φωνής για τους
 * ομιλητές στη συσκευή και Claude για περιλήψεις και πρακτικά.
 *
 * Τα dtype του Transformers.js αντιστοιχούν σε αρχεία του φακέλου onnx/ κάθε
 * repo (q8 → *_quantized.onnx). Τα μεγέθη λήψης είναι το άθροισμα encoder και
 * decoder_model_merged όπως τα δείχνει το Hugging Face (Νοέμβριος 2026).
 * Ο encoder του Whisper είναι ευαίσθητος στην κβάντιση, γι' αυτό στο WebGPU
 * μένει fp32/fp16 όπου το μέγεθος το επιτρέπει.
 */
export const LOCAL_QUALITY_PRESET_IDS = Object.freeze({
  AUTO: 'auto',
  FAST: 'fast',
  BALANCED: 'balanced',
  ACCURATE: 'accurate',
});

export const LOCAL_MODEL_PRESETS = Object.freeze([
  {
    id: LOCAL_QUALITY_PRESET_IDS.FAST,
    repo: 'onnx-community/whisper-base',
    variants: {
      webgpu: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, approxDownloadMb: 207 },
      wasm: { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, approxDownloadMb: 77 },
    },
  },
  {
    id: LOCAL_QUALITY_PRESET_IDS.BALANCED,
    repo: 'onnx-community/whisper-small',
    variants: {
      webgpu: { dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, approxDownloadMb: 410 },
      wasm: { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, approxDownloadMb: 250 },
    },
  },
  {
    id: LOCAL_QUALITY_PRESET_IDS.ACCURATE,
    repo: 'onnx-community/whisper-large-v3-turbo',
    variants: {
      webgpuShaderF16: { dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, approxDownloadMb: 565 },
      webgpu: { dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, approxDownloadMb: 760 },
    },
  },
].map(Object.freeze));

/** Αποτύπωμα φωνής (speaker embedding) για τον διαχωρισμό ομιλητών στη συσκευή. */
export const SPEAKER_EMBEDDING_MODEL = Object.freeze({
  repo: 'onnx-community/wespeaker-voxceleb-resnet34-LM',
  dtype: 'fp32',
  approxDownloadMb: 27,
});

/**
 * Τα μοντέλα Claude για περίληψη και πρακτικά, με τις τιμές του Anthropic
 * API ανά εκατομμύριο tokens (USD). Το Haiku 5.5 χρεώνει διαφορετικά πάνω από
 * 100K tokens εισόδου. Η αυτόματη εφεδρεία σε άρνηση (fallbacks: "default")
 * υπάρχει για Opus 5.5 και Sonnet 5.5, όχι για Haiku 5.5.
 */
export const CLAUDE_MODELS = Object.freeze([
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', inputUsdPerMTok: 4, outputUsdPerMTok: 20, supportsServerFallback: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', inputUsdPerMTok: 2, outputUsdPerMTok: 10, supportsServerFallback: true },
  {
    id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5, supportsServerFallback: false,
    longPrompt: { thresholdTokens: 100_000, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 },
  },
].map(Object.freeze));

export const DEFAULT_CLAUDE_MODEL_ID = 'claude-opus-5-5';

export function findClaudeModel(id) {
  return CLAUDE_MODELS.find(m => m.id === id) || null;
}

export function findLocalModelPreset(id) {
  return LOCAL_MODEL_PRESETS.find(p => p.id === id) || null;
}
