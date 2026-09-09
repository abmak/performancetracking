/**
 * Fuzzy partner-name matching and unique partner counting.
 *
 * Uses a BLOCKING approach + in-memory cache to avoid O(n²).
 * The cache stores the merged result keyed by sorted partner names,
 * so repeated requests within the same data window are instant.
 */

const _partnerCountCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function _cacheKey(names) {
  // Sort and join to make a stable cache key
  return names.slice().sort().join('|');
}

const PARTNER_STOP = new Set([
  'plc', 'p.l.c', 'ltd', 'limited', 'llc', 'l.l.c', 'co', 'company',
  'corp', 'corporation', 'inc', 'sc', 's.c', 'technology', 'technologies',
  'tech', 'solution', 'solutions', 'service', 'services', 'group', 'vas',
  'and', 'the', 'for', 'of', 'eth',
]);

function partnerTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function partnerSigTokens(name) {
  return partnerTokens(name).filter((t) => !PARTNER_STOP.has(t));
}

function tokenDice(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  setA.forEach((t) => { if (setB.has(t)) inter += 1; });
  return (2 * inter) / (a.length + b.length);
}

function charBigramDice(a, b) {
  if (a === b) return 1;
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  let inter = 0;
  setA.forEach((x) => { if (setB.has(x)) inter += 1; });
  const denom = setA.size + setB.size;
  return denom ? (2 * inter) / denom : 0;
}

function partnerNamesMatch(nameA, nameB) {
  if (!nameA || !nameB) return false;
  const flatA = partnerTokens(nameA).join(' ');
  const flatB = partnerTokens(nameB).join(' ');
  if (flatA === flatB) return true;
  const sigA = partnerSigTokens(nameA);
  const sigB = partnerSigTokens(nameB);
  if (sigA.length >= 2 && sigB.length >= 2 && tokenDice(sigA, sigB) >= 0.6) return true;
  if (sigA.length && sigB.length) {
    return charBigramDice(sigA.join(' '), sigB.join(' ')) >= 0.85;
  }
  return flatA.length >= 6 && flatB.length >= 6 && charBigramDice(flatA, flatB) >= 0.95;
}

/**
 * Extract a blocking key from a partner name — the first significant token.
 * Partners with the same first word likely belong to the same company.
 */
function blockKey(name) {
  const sig = partnerSigTokens(name);
  if (sig.length > 0) return sig[0];
  const all = partnerTokens(name);
  return all.length > 0 ? all[0] : '_';
}

function _computeUniquePartners(names) {
  const blocks = new Map();
  const canonicals = [];

  for (const name of names) {
    const key = blockKey(name);
    let matched = false;

    // Check same block first
    const bucket = blocks.get(key);
    if (bucket) {
      for (const c of bucket) {
        if (partnerNamesMatch(name, c.name)) {
          matched = true;
          break;
        }
      }
    }

    // Cross-block fallback
    if (!matched) {
      for (const c of canonicals) {
        if (partnerNamesMatch(name, c.name)) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      const entry = { name };
      canonicals.push(entry);
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(entry);
    }
  }
  return canonicals.length;
}

/**
 * Count unique partners from an array of { partner_name } rows.
 * Uses in-memory cache so repeated requests are instant.
 */
function countUniqueFuzzyPartners(rows) {
  const names = rows.map(r => typeof r === 'string' ? r : r.partner_name).filter(Boolean);
  if (names.length === 0) return 0;

  // Check cache
  const key = _cacheKey(names);
  const cached = _partnerCountCache.get(key);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.count;
  }

  // Compute and cache
  const count = _computeUniquePartners(names);
  _partnerCountCache.set(key, { count, ts: Date.now() });

  // Evict stale entries
  if (_partnerCountCache.size > 50) {
    for (const [k, v] of _partnerCountCache) {
      if (Date.now() - v.ts > CACHE_TTL_MS) _partnerCountCache.delete(k);
    }
  }

  return count;
}

module.exports = {
  partnerNamesMatch,
  partnerTokens,
  partnerSigTokens,
  tokenDice,
  charBigramDice,
  countUniqueFuzzyPartners,
  PARTNER_STOP,
};
