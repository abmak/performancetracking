/**
 * Simple in-memory endpoint response cache.
 * Caches the entire JSON response for a given key + params combination.
 */

const _cache = new Map();
const DEFAULT_TTL = 15 * 60 * 1000; // 15 minutes

function cacheKey(route, params) {
  const sorted = Object.keys(params || {}).sort().map(k => `${k}=${params[k]}`).join('&');
  return `${route}?${sorted}`;
}

function getCached(route, params) {
  const key = cacheKey(route, params);
  const entry = _cache.get(key);
  if (entry && (Date.now() - entry.ts) < (entry.ttl || DEFAULT_TTL)) {
    return entry.data;
  }
  _cache.delete(key);
  return null;
}

function setCached(route, params, data, ttlMs) {
  const key = cacheKey(route, params);
  _cache.set(key, { data, ts: Date.now(), ttl: ttlMs || DEFAULT_TTL });
  // Evict stale entries
  if (_cache.size > 100) {
    for (const [k, v] of _cache) {
      if (Date.now() - v.ts > (v.ttl || DEFAULT_TTL)) _cache.delete(k);
    }
  }
}

function invalidate(route) {
  if (!route) { _cache.clear(); return; }
  for (const k of _cache.keys()) {
    if (k.startsWith(route)) _cache.delete(k);
  }
}

module.exports = { getCached, setCached, invalidate };
