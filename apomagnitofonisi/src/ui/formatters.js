/**
 * Μορφοποίηση για τη διεπαφή (ελληνικά): μεγέθη, διάρκειες, ημερομηνίες, ποσά.
 * Τα ποσά και τα ποσοστά ζουν στο number-format.js (μία πηγή, OO-009) και
 * εξάγονται και από εδώ, ώστε οι προβολές να έχουν ένα σημείο εισαγωγής.
 */
import { STRINGS } from './strings.js';
import { formatCompactClock } from '../domain/time-format.js';

export { formatPrice, formatUsd, formatPercent } from './number-format.js';

const dateFormatter = new Intl.DateTimeFormat('el-GR', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormatter = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1 });

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return STRINGS.common.notAvailable;
  const { units } = STRINGS;
  if (bytes < 1024) return `${bytes} ${units.bytes}`;
  if (bytes < 1024 ** 2) return `${numberFormatter.format(bytes / 1024)} ${units.kb}`;
  if (bytes < 1024 ** 3) return `${numberFormatter.format(bytes / 1024 ** 2)} ${units.mb}`;
  return `${numberFormatter.format(bytes / 1024 ** 3)} ${units.gb}`;
}

export function formatDuration(seconds) {
  return Number.isFinite(seconds) ? formatCompactClock(seconds) : STRINGS.common.notAvailable;
}

export function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}
