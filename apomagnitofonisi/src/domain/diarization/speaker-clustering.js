/**
 * Ομαδοποίηση τμημάτων σε ομιλητές από τα «αποτυπώματα φωνής» τους
 * (speaker embeddings).
 *
 * Ιεραρχική συσσωρευτική ομαδοποίηση με μέση σύνδεση (average linkage) και
 * απόσταση συνημιτόνου. Χρησιμοποιείται ο αλγόριθμος της αλυσίδας πλησιέστερων
 * γειτόνων (NN-chain), που δίνει το ίδιο δενδρόγραμμα με τον κλασικό αλγόριθμο
 * σε O(n²) αντί για O(n³): μία ώρα σύσκεψης (~1.000 τμήματα) ομαδοποιείται σε
 * κλάσματα του δευτερολέπτου. Το δενδρόγραμμα κόβεται είτε σε γνωστό πλήθος
 * ομιλητών είτε σε όριο απόστασης.
 *
 * Τα αποτελέσματα είναι ντετερμινιστικά: σε ισοπαλίες κερδίζει ο μικρότερος
 * δείκτης, και οι ετικέτες αριθμούνται με τη σειρά που εμφανίζεται πρώτη φορά
 * κάθε ομιλητής.
 */

/** Απόσταση συνημιτόνου (1 - ομοιότητα) κάτω από την οποία δύο ομάδες ενώνονται. */
export const DEFAULT_DISTANCE_THRESHOLD = 0.55;

/**
 * @param {ArrayLike<number>[]} embeddings  ένα διάνυσμα ανά τμήμα, με τη σειρά του χρόνου
 * @param {{ speakerCount?: number|null, distanceThreshold?: number }} [options]
 * @returns {number[]} ετικέτα ομιλητή (0, 1, …) ανά τμήμα
 */
export function clusterEmbeddings(embeddings, { speakerCount = null, distanceThreshold = DEFAULT_DISTANCE_THRESHOLD } = {}) {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const vectors = embeddings.map(unitVector);
  const distances = cosineDistanceMatrix(vectors);
  const merges = averageLinkageMerges(distances, n).sort((x, y) => x.distance - y.distance);

  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = i => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  let clusters = n;
  const target = speakerCount != null ? Math.max(1, Math.min(n, Math.round(speakerCount))) : null;
  for (const merge of merges) {
    if (target != null ? clusters <= target : merge.distance > distanceThreshold) break;
    const ra = find(merge.a);
    const rb = find(merge.b);
    if (ra === rb) continue;
    parent[Math.max(ra, rb)] = Math.min(ra, rb);
    clusters -= 1;
  }
  return labelsByFirstAppearance(Array.from({ length: n }, (_, i) => find(i)));
}

/**
 * Συμπληρώνει τις ετικέτες που λείπουν (τμήματα πολύ μικρά για αξιόπιστο
 * αποτύπωμα) με την ετικέτα του πλησιέστερου στον χρόνο τμήματος που έχει.
 * Σε ισοπαλία κερδίζει το προηγούμενο τμήμα.
 *
 * @param {(number|null)[]} labels
 * @param {{ start: number, end: number }[]} segments  ίδιο μήκος, ταξινομημένα κατά χρόνο
 * @returns {number[]}
 */
export function fillMissingLabels(labels, segments) {
  if (labels.length !== segments.length) throw new RangeError('διαφορετικό πλήθος ετικετών και τμημάτων');
  const known = labels.map((label, i) => (label == null ? -1 : i)).filter(i => i !== -1);
  if (!known.length) return labels.map(() => 0);
  return labels.map((label, i) => {
    if (label != null) return label;
    // Τα known είναι σε αύξουσα σειρά: με αυστηρό «<» η ισοπαλία μένει στο προηγούμενο.
    let best = known[0];
    let bestGap = Infinity;
    for (const j of known) {
      const gap = Math.max(0, j < i ? segments[i].start - segments[j].end : segments[j].start - segments[i].end);
      if (gap < bestGap) { best = j; bestGap = gap; }
    }
    return labels[best];
  });
}

/* ---------------------------------------------------------------- εσωτερικά */

function unitVector(values) {
  const v = Float64Array.from(values);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function cosineDistanceMatrix(vectors) {
  const n = vectors.length;
  const matrix = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dot = 0;
      const a = vectors[i];
      const b = vectors[j];
      for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
      const distance = 1 - Math.max(-1, Math.min(1, dot));
      matrix[i * n + j] = distance;
      matrix[j * n + i] = distance;
    }
  }
  return matrix;
}

/**
 * Όλες οι ενώσεις του δενδρογράμματος με μέση σύνδεση (NN-chain). Κάθε ένωση
 * αναφέρει έναν αντιπρόσωπο (αρχικό σημείο) από κάθε ομάδα και την απόσταση.
 * Ο πίνακας αποστάσεων ενημερώνεται επί τόπου (Lance–Williams).
 */
function averageLinkageMerges(distances, n) {
  const size = new Float64Array(n).fill(1);
  const active = new Uint8Array(n).fill(1);
  let activeCount = n;
  const merges = [];
  const chain = [];
  while (activeCount > 1) {
    if (!chain.length) chain.push(active.indexOf(1));
    const a = chain[chain.length - 1];
    const previous = chain.length >= 2 ? chain[chain.length - 2] : -1;
    let nearest = -1;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === a || !active[j]) continue;
      const d = distances[a * n + j];
      if (d < best || (d === best && j === previous)) { best = d; nearest = j; }
    }
    if (nearest !== previous) { chain.push(nearest); continue; }
    chain.pop();
    chain.pop();
    merges.push({ a, b: nearest, distance: best });
    const keep = Math.min(a, nearest);
    const drop = Math.max(a, nearest);
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === keep || k === drop) continue;
      const d = (size[keep] * distances[keep * n + k] + size[drop] * distances[drop * n + k]) / (size[keep] + size[drop]);
      distances[keep * n + k] = d;
      distances[k * n + keep] = d;
    }
    size[keep] += size[drop];
    active[drop] = 0;
    activeCount -= 1;
  }
  return merges;
}

function labelsByFirstAppearance(roots) {
  const labelOf = new Map();
  return roots.map(root => {
    if (!labelOf.has(root)) labelOf.set(root, labelOf.size);
    return labelOf.get(root);
  });
}
