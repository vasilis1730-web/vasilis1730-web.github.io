/** Η ώρα του συστήματος σε ISO 8601 (θύρα Clock). */
export const systemClock = Object.freeze({ nowIso: () => new Date().toISOString() });
