/**
 * Ποσά και ποσοστά στα ελληνικά, χωρίς κείμενα της διεπαφής. Τα χρησιμοποιούν
 * και τα κείμενα (strings.js, π.χ. η τιμή ανά ώρα ήχου) και οι μορφοποιήσεις
 * (formatters.js), ώστε κάθε τιμή να γράφεται με έναν μόνο τρόπο (OO-009).
 * Ξεχωριστό module, γιατί το formatters.js εξαρτάται από το strings.js.
 */
const usdFormatter = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 });
const priceFormatter = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «0,40 $»: τιμή καταλόγου (ανά ώρα ήχου ή ανά εκατομμύριο tokens). */
export function formatPrice(usd) {
  return `${priceFormatter.format(usd)} $`;
}

/** Εκτιμώμενο κόστος σε δολάρια, ποτέ κάτω από 0,001 $. */
export function formatUsd(amount) {
  return usdFormatter.format(amount < 0.001 ? 0.001 : amount);
}

/** «42%» από κλάσμα 0 έως 1. */
export function formatPercent(fraction) {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
