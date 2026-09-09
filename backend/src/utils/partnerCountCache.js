/**
 * Shared partner count cache.
 * Pre-computed on startup and shared across Dashboard + Partners endpoints.
 * The fuzzy merge (1.5s) runs only once; all endpoints read from this cache.
 */

const pool = require('../config/database');
const { countUniqueFuzzyPartners } = require('./partnerMerge');

let _partnerCount = null;
let _partnerCountLoading = false;
let _lastComputed = 0;
const REFRESH_INTERVAL = 5 * 60 * 1000; // refresh every 5 min

async function computePartnerCount(startMonth, endMonth) {
  const start = Date.now();
  const prParams = [];
  const arParams = [];
  let prFilter = '';
  let arFilter = '';
  if (startMonth && endMonth) {
    prFilter = 'WHERE revenue_month >= ? AND revenue_month <= ?';
    prParams.push(startMonth, endMonth);
    arFilter = 'WHERE ar.revenue_month >= ? AND ar.revenue_month <= ?';
    arParams.push(startMonth, endMonth);
  }
  
  const [rows] = await pool.execute(
    `SELECT DISTINCT partner_name FROM (
      SELECT partner_name FROM partner_revenue ${prFilter}${prFilter ? ' AND' : ' WHERE'} partner_name IS NOT NULL AND partner_name != ''
      UNION ALL
      SELECT COALESCE(ar.partner_name, 'Manual') as partner_name FROM actual_revenue ar ${arFilter}${arFilter ? ' AND' : ' WHERE'} ar.partner_name IS NOT NULL AND ar.partner_name != ''
    ) combined`,
    [...prParams, ...arParams]
  );
  
  const count = countUniqueFuzzyPartners(rows);
  const elapsed = Date.now() - start;
  console.log(`🔢 Partner count computed: ${count} unique (${elapsed}ms, ${rows.length} raw names)`);
  return count;
}

/**
 * Get the pre-computed partner count. Returns immediately (no async).
 * Falls back to 0 if not yet computed.
 */
function getPartnerCount() {
  return _partnerCount || 0;
}

/**
 * Pre-warm the partner count on startup.
 * This runs the fuzzy merge once so subsequent requests are instant.
 */
async function warmPartnerCount() {
  if (_partnerCountLoading) return;
  _partnerCountLoading = true;
  try {
    // Default range: all data
    _partnerCount = await computePartnerCount(null, null);
    _lastComputed = Date.now();
    console.log(`✅ Partner count cache warmed: ${_partnerCount}`);
  } catch (err) {
    console.error('⚠️ Partner count warm failed:', err.message);
  } finally {
    _partnerCountLoading = false;
  }
}

/**
 * Get partner count for a specific date range.
 * If range matches the pre-computed range, returns instantly.
 * Otherwise computes on-demand (still cached for 5 min).
 */
let _rangeCache = {};
async function getPartnerCountForRange(startMonth, endMonth) {
  const key = `${startMonth || 'all'}|${endMonth || 'all'}`;
  
  // If no date filter, use the pre-computed all-data count
  if (!startMonth && !endMonth && _partnerCount !== null) {
    return _partnerCount;
  }
  
  // Check range cache
  const cached = _rangeCache[key];
  if (cached && (Date.now() - cached.ts) < REFRESH_INTERVAL) {
    return cached.count;
  }
  
  // Compute and cache
  const count = await computePartnerCount(startMonth, endMonth);
  _rangeCache[key] = { count, ts: Date.now() };
  
  // Evict old entries
  if (Object.keys(_rangeCache).length > 20) {
    for (const [k, v] of Object.entries(_rangeCache)) {
      if (Date.now() - v.ts > REFRESH_INTERVAL) delete _rangeCache[k];
    }
  }
  
  return count;
}

module.exports = { getPartnerCount, getPartnerCountForRange, warmPartnerCount };
