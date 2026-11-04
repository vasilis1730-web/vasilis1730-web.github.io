/**
 * Η ρίζα του repository, κοινή για όλα τα εργαλεία και τα tests.
 */
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
