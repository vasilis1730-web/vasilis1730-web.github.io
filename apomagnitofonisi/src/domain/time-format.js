/**
 * Μορφές χρόνου: ρολόι της διεπαφής και των εξαγωγών (hh:mm:ss), SRT
 * (00:00:00,000) και WebVTT (00:00:00.000). Αρνητικές ή μη αριθμητικές τιμές
 * γίνονται 0, ώστε μια λάθος τιμή της μηχανής να μη σπάσει ποτέ ένα αρχείο.
 */

function parts(totalSeconds) {
  const totalMs = Math.round((Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0) * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  return { hours: Math.floor(totalSec / 3600), minutes: Math.floor((totalSec % 3600) / 60), seconds: totalSec % 60, ms };
}

const two = n => String(n).padStart(2, '0');
const three = n => String(n).padStart(3, '0');

/** «01:02:03»: πάντα με ώρες, για εξαγωγές και prompts. */
export function formatClock(totalSeconds) {
  const { hours, minutes, seconds } = parts(totalSeconds);
  return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

/** «2:03» ή «1:02:03»: σύντομο ρολόι για τη διεπαφή. */
export function formatCompactClock(totalSeconds) {
  const { hours, minutes, seconds } = parts(totalSeconds);
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** «00:01:02,345» για SubRip (.srt). */
export function formatSrtTimestamp(totalSeconds) {
  const { hours, minutes, seconds, ms } = parts(totalSeconds);
  return `${two(hours)}:${two(minutes)}:${two(seconds)},${three(ms)}`;
}

/** «00:01:02.345» για WebVTT (.vtt). */
export function formatVttTimestamp(totalSeconds) {
  const { hours, minutes, seconds, ms } = parts(totalSeconds);
  return `${two(hours)}:${two(minutes)}:${two(seconds)}.${three(ms)}`;
}
