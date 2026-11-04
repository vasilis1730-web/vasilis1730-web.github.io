/**
 * Μορφοποίηση για τη διεπαφή (ελληνικά): μεγέθη, διάρκειες, ημερομηνίες, ποσά.
 */
import { STRINGS } from './strings.js';
import { formatCompactClock } from '../domain/time-format.js';

const dateFormatter = new Intl.DateTimeFormat('el-GR', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormatter = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1 });
const usdFormatter = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 });

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

export function formatUsd(amount) {
  return usdFormatter.format(amount < 0.001 ? 0.001 : amount);
}

const priceFormatter = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «0,10 $» για τιμές ανά εκατομμύριο tokens. */
export function formatPrice(usd) {
  return `${priceFormatter.format(usd)} $`;
}

export function formatPercent(fraction) {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
