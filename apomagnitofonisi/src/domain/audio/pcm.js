/**
 * Βασικές πράξεις σε PCM float32 (τιμές περίπου στο [-1, 1]).
 */

/** Μέσος όρος των καναλιών σε ένα κανάλι. Ένα κανάλι επιστρέφεται ως έχει. */
export function downmixToMono(planes) {
  if (!planes.length) return new Float32Array(0);
  if (planes.length === 1) return planes[0];
  const length = planes[0].length;
  const mono = new Float32Array(length);
  for (const plane of planes) {
    for (let i = 0; i < length; i++) mono[i] += plane[i];
  }
  const scale = 1 / planes.length;
  for (let i = 0; i < length; i++) mono[i] *= scale;
  return mono;
}

/** Ρίζα μέσου τετραγώνου του τμήματος [start, end). Άδειο τμήμα → 0. */
export function rms(samples, start = 0, end = samples.length) {
  const from = Math.max(0, start);
  const to = Math.min(samples.length, end);
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}
