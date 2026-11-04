/**
 * Μικρό περίβλημα του IndexedDB με promises.
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';

/**
 * @param {IDBFactory} factory
 * @param {string} name
 * @param {number} version
 * @param {(db: IDBDatabase, oldVersion: number) => void} upgrade
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase(factory, name, version, upgrade) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new AppError(ERROR_CODES.DEVICE_UNSUPPORTED, 'δεν υπάρχει IndexedDB')); return; }
    const request = factory.open(name, version);
    request.onupgradeneeded = event => upgrade(request.result, event.oldVersion);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new AppError(ERROR_CODES.UNKNOWN, 'η βάση είναι ανοιχτή σε άλλη καρτέλα με παλιότερη έκδοση'));
  });
}

/** @template T @param {IDBRequest<T>} request @returns {Promise<T>} */
export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

/** @param {IDBTransaction} transaction @returns {Promise<void>} */
export function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

function storageError(error) {
  if (error && error.name === 'QuotaExceededError') return new AppError(ERROR_CODES.STORAGE_FULL, 'δεν υπάρχει χώρος στη συσκευή', { cause: error });
  return new AppError(ERROR_CODES.UNKNOWN, error ? error.message : 'σφάλμα IndexedDB', { cause: error });
}
