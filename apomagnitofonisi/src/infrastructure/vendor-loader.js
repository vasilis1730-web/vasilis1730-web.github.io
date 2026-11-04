/**
 * Φόρτωση εξωτερικών βιβλιοθηκών (ES modules) μόνο όταν χρειαστούν, μία φορά
 * η καθεμία. Τα URL έρχονται από το config/vendor.js. Η ίδια η εισαγωγή
 * (`importModule`) δίνεται απ' έξω, ώστε τα tests να δίνουν ψεύτικα modules
 * χωρίς δίκτυο. Αποτυχημένη φόρτωση δεν μένει στη μνήμη: η επόμενη κλήση
 * ξαναδοκιμάζει (π.χ. όταν επανέλθει το δίκτυο).
 */
import { AppError, ERROR_CODES } from '../application/errors.js';

/**
 * @param {(url: string) => Promise<any>} [importModule]
 * @returns {(url: string) => Promise<any>}
 */
export function createModuleLoader(importModule = url => import(url)) {
  const cache = new Map();
  return url => {
    if (!cache.has(url)) {
      const loading = importModule(url).catch(error => {
        cache.delete(url);
        throw new AppError(ERROR_CODES.NETWORK, `δεν φόρτωσε η βιβλιοθήκη ${url}`, { cause: error });
      });
      cache.set(url, loading);
    }
    return cache.get(url);
  };
}
