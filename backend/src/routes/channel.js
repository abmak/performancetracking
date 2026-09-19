/**
 * Indirect Channel — dashboard, registry and single registration.
 *
 * All routes live under /api/channel/* so their cache keys can never collide
 * with the VAS endpoints in the shared in-memory endpoint cache.
 */
const express = require('express');
const router = express.Router();
const https = require('https');

const pool = require('../config/database');
const { getCached, setCached, invalidate } = require('../utils/endpointCache');
const { isMasterAdmin } = require('../middleware/permissions');
const { ensureChannelSchema, assignIdentifierCodes } = require('../config/channelDbSetup');

/**
 * Fetch data from eTrade API with timeout and HTTPS handling.
 */
function fetchEtradeJson(path) {
  return new Promise((resolve) => {
    const req = https.get(`https://etrade.gov.et/${path}`, {
      rejectUnauthorized: false,
      timeout: 10000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TargetTracking/1.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 500, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 504, error: 'Request timeout from eTrade' });
    });
  });
}

// ── Access guard ───────────────────────────────────────────────────────────
// Until the section registry is live, Admins and any user with no explicit
// section may use the channel module; channel staff will be gated by section.
function requireChannelAccess(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const section = user.section || null;
  if (isMasterAdmin(req) || section === null || section === 'INDIRECT_CHANNEL') {
    return next();
  }
  return res.status(403).json({
    error: 'This module belongs to the Indirect Channel section',
    your_section: section,
  });
}

router.use(requireChannelAccess);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** Trim a free-text field down to its column width, or null when empty. */
const text = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max) || null;
const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const LEVEL_LABELS = { 1: 'Distributor', 2: 'Sub-Distributor', 3: 'Retailer' };

// ── Period helpers ─────────────────────────────────────────────────────────

function normalizePeriod(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  if (!m) return null;
  const mm = String(m[2]).padStart(2, '0');
  if (Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${mm}-01`;
}

/**
 * The period slice a balance-reading query applies to `channel_stock_balances b`.
 *
 * With no period asked for, the answer is **current stock**: the balance row the
 * channel user was given most recently. The Available Balance column of an
 * import is the stock on the account right now, not a month-end figure, and
 * different files arrive for different users — so the old
 * global `MAX(period_month)` slice hid every user whose latest stock came from
 * an earlier file. Correlating to the entity's own newest row is an index
 * lookup on uq_channel_balance (entity_id, period_month, product).
 *
 * Naming a period or a range still reproduces that historic view exactly.
 */
const CURRENT_STOCK_PREDICATE = 'b.period_month = (SELECT MAX(b2.period_month) FROM channel_stock_balances b2 WHERE b2.entity_id = b.entity_id)';

function periodClause({ period, from, to }) {
  const p = normalizePeriod(period);
  const f = normalizePeriod(from);
  const t = normalizePeriod(to);
  if (p) return { clause: 'b.period_month = ?', params: [p], scope: 'period' };
  if (f && t) return { clause: 'b.period_month BETWEEN ? AND ?', params: [f, t], scope: 'range' };
  if (f) return { clause: 'b.period_month >= ?', params: [f], scope: 'range' };
  if (t) return { clause: 'b.period_month <= ?', params: [t], scope: 'range' };
  return { clause: CURRENT_STOCK_PREDICATE, params: [], scope: 'current' };
}

/**
 * The balance a channel user holds right now, as a correlated join predicate.
 *
 * Used as `LEFT JOIN channel_stock_balances b ON b.entity_id = <expr> AND
 * ${currentStockOf('<expr>')}` when a query drives from `channel_entities`
 * rather than from the balances table, so it cannot use the shared `b` alias.
 */
function currentStockOf(entityExpr) {
  return `b.period_month = (SELECT MAX(b2.period_month) FROM channel_stock_balances b2 WHERE b2.entity_id = ${entityExpr})`;
}

/**
 * `ON` predicate for a LEFT JOIN onto `channel_stock_balances b` when the query
 * is driven from `channel_entities` rather than from the balances table — same
 * period scope as `periodClause`, but correlated to the entity being counted.
 */
function stockJoinOn(entityExpr, { period, from, to }) {
  const p = normalizePeriod(period);
  const f = normalizePeriod(from);
  const t = normalizePeriod(to);
  if (p) return { sql: 'b.period_month = ?', params: [p] };
  if (f && t) return { sql: 'b.period_month BETWEEN ? AND ?', params: [f, t] };
  if (f) return { sql: 'b.period_month >= ?', params: [f] };
  if (t) return { sql: 'b.period_month <= ?', params: [t] };
  return { sql: currentStockOf(entityExpr), params: [] };
}

/**
 * The period slice an entity-*counting* query applies to `channel_entities e`.
 *
 * Counting has to come from the registry, never from `channel_stock_balances`.
 * In the IDC extract the Available Balance on a Sub-Distributor or a Retailer
 * row is the **Distributor's** stock, so it is written to the distributor only —
 * which meant every balance-driven count reported zero Sub-Distributors and
 * zero Retailers the moment a file landed, however many were on the register.
 *
 * Registry presence is the honest answer: an entity existed during a period when
 * its first_seen/last_seen window covers it (both NULL-safe, because a manually
 * registered entity may carry neither). No period asked for → current scope,
 * every entity on the register.
 */
function entityPresence({ period, from, to }) {
  // Membership is cumulative: a file that lists only Retailers does not remove
  // the Distributors and Sub-Distributors already on the register. The boundary
  // is therefore `first_seen` — an entity counts from the period it first
  // appeared in, and keeps counting. Both columns are NULL for an entity added
  // by hand, so they are guarded.
  const seen = "COALESCE(e.first_seen_period, '1970-01-01')";
  const last = "COALESCE(e.last_seen_period, '9999-12-31')";
  const p = normalizePeriod(period);
  const f = normalizePeriod(from);
  const t = normalizePeriod(to);
  if (p) return { sql: `${seen} <= ?`, params: [p] };
  if (f && t) return { sql: `${seen} <= ?`, params: [t] };
  if (f) return { sql: `${last} >= ?`, params: [f] };
  if (t) return { sql: `${seen} <= ?`, params: [t] };  return { sql: '1 = 1', params: [] };
}

/**
 * Like `entityPresence`, but excludes uplines that the import created
 * automatically (is_inferred = 1).  The dashboard asks "how many retailers,
 * sub-distributors and distributors did we import?" — a question about the
 * source file — so the auto-created uplines that the file *named* but the
 * operator never typed should not inflate those counts or appear in the
 * dimension charts (business type, air-time type, geography).
 *
 * The level reports and the hierarchy view *do* include inferred entities,
 * because they are real members of the chain once the import created them.
 */
function entityPresenceDirect({ period, from, to }) {
  const base = entityPresence({ period, from, to });
  return {
    sql: `${base.sql} AND e.is_inferred = 0`,
    params: base.params,
  };
}



// DATE_FORMAT everywhere a period leaves the API: mysql2 hands DATE columns back
// as JS Dates, which JSON-serialise in UTC and shift a 1st-of-month back a day.
async function latestPeriod() {
  const [rows] = await pool.query(
    "SELECT DATE_FORMAT(MAX(period_month), '%Y-%m-%d') AS p FROM channel_stock_balances"
  );
  return rows[0]?.p || null;
}

// ── GET /api/channel/meta ──────────────────────────────────────────────────

router.get('/meta', async (req, res) => {
  try {
    await ensureChannelSchema();
    const [domains] = await pool.query('SELECT id, code, name, sort_order FROM channel_domains ORDER BY sort_order');
    const [categories] = await pool.query(
      `SELECT c.id, c.code, c.name, c.level, c.domain_id, d.code AS domain_code, d.name AS domain_name
         FROM channel_categories c JOIN channel_domains d ON d.id = c.domain_id
        ORDER BY d.sort_order, c.level`
    );
    // Periods an operator can filter by. Stock-balance periods are only one
    // source now that balance is no longer imported — the register's own
    // first-seen months are the other, so the picker stays useful on a system
    // whose only history is the imports themselves.
    const [periods] = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT DATE_FORMAT(period_month, '%Y-%m-01') AS period_month
           FROM channel_stock_balances
         UNION
         SELECT DISTINCT DATE_FORMAT(first_seen_period, '%Y-%m-01') AS period_month
           FROM channel_entities WHERE first_seen_period IS NOT NULL
       ) p ORDER BY period_month DESC LIMIT 60`
    );
    const [counts] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM channel_entities) AS entities,
              (SELECT COUNT(*) FROM channel_stock_balances) AS balance_rows,
              (SELECT COUNT(*) FROM channel_import_batches WHERE status = 'completed') AS batches`
    );
    const [geo] = await pool.query(
      `SELECT geo_domain_raw AS value, COUNT(*) AS entities
         FROM channel_entities WHERE geo_domain_raw IS NOT NULL
        GROUP BY geo_domain_raw ORDER BY entities DESC LIMIT 500`
    );

    res.json({
      domains, categories, geo_values: geo,
      periods: periods.map((p) => p.period_month),
      latest_period: periods[0]?.period_month || null,
      counts: counts[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/dashboard/kpis ────────────────────────────────────────

router.get('/dashboard/kpis', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { period, from, to } = req.query;
    const cached = getCached('/channel/dashboard/kpis', { period, from, to });
    if (cached) return res.json(cached);

    const { clause, params, scope } = periodClause({ period, from, to });
    // Balance still comes from the balance rows; every entity *count* comes from
    // the register, because a retailer's stock is held by its distributor.
    const stock = stockJoinOn('e.id', { period, from, to });
    // `present` excludes auto-created uplines (is_inferred) — the operator
    // cares how many retailers they imported, not how many uplines the file
    // named.  `presentAll` keeps the full registry so the level breakdown and
    // the category split still show every member of the chain.
    const present = entityPresenceDirect({ period, from, to });
    const presentAll = entityPresence({ period, from, to });

    const [totals] = await pool.query(
      `SELECT COALESCE(SUM(b.available_balance), 0) AS total_balance,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COUNT(DISTINCT b.period_month) AS periods
         FROM channel_stock_balances b WHERE ${clause}`,
      params
    );

    // The headline count shows what the file directly carried.
    const [registry] = await pool.query(
      `SELECT COUNT(*) AS entities FROM channel_entities e WHERE ${present.sql}`,
      present.params
    );

    // Grouped by level alone: several domains label their own level-1 category
    // ("Bank, Fintech & International"), which would otherwise split one level
    // across two bars. The by_category breakdown keeps the finer distinction.
    const [byLevel] = await pool.query(
      `SELECT c.level,
              CASE c.level WHEN 1 THEN 'Distributor' WHEN 2 THEN 'Sub-Distributor' ELSE 'Retailer' END AS label,
              COUNT(DISTINCT e.id) AS entities,
              SUM(e.status = 'active') AS active_entities,
              SUM(e.status <> 'active') AS inactive_entities,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${stock.sql}
        WHERE ${presentAll.sql}
        GROUP BY c.level ORDER BY c.level`,
      [...stock.params, ...presentAll.params]
    );

    const [byDomain] = await pool.query(
      `SELECT d.code AS domain_code, d.name AS domain_name,
              COUNT(DISTINCT e.id) AS entities,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
         LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${stock.sql}
        WHERE ${presentAll.sql}
        GROUP BY d.code, d.name, d.sort_order ORDER BY d.sort_order`,
      [...stock.params, ...presentAll.params]
    );

    const [status] = await pool.query(
      `SELECT e.status, COUNT(DISTINCT e.id) AS entities
         FROM channel_entities e
        WHERE ${present.sql} GROUP BY e.status`,
      present.params
    );

    // Category split — the retailer extract mixes IC- and AC- rows, so the
    // dashboard reports them separately rather than as one "Retailer" line.
    const [byCategory] = await pool.query(
      `SELECT c.code AS category_code, c.name AS category_label, c.level,
              d.code AS domain_code, d.name AS domain_name,
              COUNT(DISTINCT e.id) AS entities,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
         LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${stock.sql}
        WHERE ${presentAll.sql}
        GROUP BY c.code, c.name, c.level, d.code, d.name, d.sort_order
        ORDER BY d.sort_order, c.level`,
      [...stock.params, ...presentAll.params]
    );

    const [summary] = await pool.query(
      scope === 'period'
        ? 'SELECT COALESCE(SUM(stock_balance), 0) AS total, COUNT(*) AS rows_n FROM channel_stock_summary WHERE period_month = ?'
        : `SELECT COALESCE(SUM(stock_balance), 0) AS total, COUNT(*) AS rows_n FROM channel_stock_summary
            WHERE period_month IN (SELECT DISTINCT period_month FROM channel_stock_balances b WHERE ${clause})`,
      params
    );

    const [geo] = await pool.query(
      `SELECT COUNT(DISTINCT e.geo_domain_raw) AS areas FROM channel_entities e
        WHERE ${present.sql} AND e.geo_domain_raw IS NOT NULL`,
      present.params
    );

    const detailTotal = round2(totals[0].total_balance);
    const summaryTotal = summary[0].rows_n ? round2(summary[0].total) : null;

    const statusMap = Object.fromEntries(status.map((s) => [s.status, Number(s.entities)]));

    // Air-time type (product) and the "existing business" the user runs — the
    // two dimensions the IDC extract carries beyond the hierarchy itself.
    const [byProduct] = await pool.query(
      `SELECT COALESCE(NULLIF(e.product, ''), 'Unspecified') AS product,
              COUNT(DISTINCT e.id) AS entities,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${stock.sql}
        WHERE ${present.sql}
        GROUP BY product ORDER BY entities DESC LIMIT 50`,
      [...stock.params, ...present.params]
    );

    const [byBusiness] = await pool.query(
      `SELECT COALESCE(NULLIF(e.business_type, ''), 'Unspecified') AS business_type,
              COUNT(DISTINCT e.id) AS entities,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${stock.sql}
        WHERE ${present.sql}
        GROUP BY business_type ORDER BY entities DESC LIMIT 50`,
      [...stock.params, ...present.params]
    );

    const levelEntities = (wanted) => byLevel
      .filter((r) => Number(r.level) === wanted)
      .reduce((a, r) => a + Number(r.entities), 0);

    // A user's stock is held by their distributor, so the register holds far more
    // users than the balance table holds balances — report both.
    const entitiesWithBalance = Number(totals[0].entities_with_balance) || 0;

    const payload = {
      scope,
      period_label: scope === 'period' ? normalizePeriod(period) : { from: normalizePeriod(from), to: normalizePeriod(to) },
      latest_period: await latestPeriod(),
      total_stock_balance: detailTotal,
      summary_stock_balance: summaryTotal,
      variance: summaryTotal === null ? null : round2(summaryTotal - detailTotal),
      total_entities: Number(registry[0].entities) || 0,
      entities_with_balance: entitiesWithBalance,
      periods_covered: Number(totals[0].periods),
      active_entities: statusMap.active || 0,
      canceled_entities: statusMap.canceled || 0,
      inactive_entities: statusMap.inactive || 0,
      geo_areas: Number(geo[0].areas),
      domains_covered: byDomain.length,
      by_level: byLevel.map((r) => ({
        ...r,
        entities: Number(r.entities),
        active_entities: Number(r.active_entities) || 0,
        inactive_entities: Number(r.inactive_entities) || 0,
        balance: round2(r.balance),
      })),
      by_domain: byDomain.map((r) => ({ ...r, entities: Number(r.entities), balance: round2(r.balance) })),
      by_category: byCategory.map((r) => ({ ...r, entities: Number(r.entities), balance: round2(r.balance) })),
      by_product: byProduct.map((r) => ({ ...r, entities: Number(r.entities), balance: round2(r.balance) })),
      by_business_type: byBusiness.map((r) => ({ ...r, entities: Number(r.entities), balance: round2(r.balance) })),
      // Convenience split for the retailer extract: IC vs AC.
      ic_entities: byCategory.filter((r) => /^IC_/.test(r.category_code)).reduce((a, r) => a + Number(r.entities), 0),
      ac_entities: byCategory.filter((r) => /^AC_/.test(r.category_code)).reduce((a, r) => a + Number(r.entities), 0),
      retail_entities: byCategory.filter((r) => Number(r.level) === 3).reduce((a, r) => a + Number(r.entities), 0),
      distributor_entities: levelEntities(1),
      sub_distributor_entities: levelEntities(2),
      // Averaged over the users who actually hold stock, not over every user on
      // the register — the rest are covered by their distributor's balance.
      avg_balance_per_entity: entitiesWithBalance ? round2(detailTotal / entitiesWithBalance) : 0,
      // Convenience lookups for the reports' level charts — the same numbers as
      // `by_level`, keyed by level.
      distributors: levelEntities(1),
      sub_distributors: levelEntities(2),
      retailers: levelEntities(3),
    };

    // 2-minute TTL — short enough that stale data after a delete is visible only
    // briefly; invalidate('/channel') still clears this immediately on any write.
    setCached('/channel/dashboard/kpis', { period, from, to }, payload, 2 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/dashboard/matrix ──────────────────────────────────────
// The headline view: domain x category, detail next to the authoritative summary.

router.get('/dashboard/matrix', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { period } = req.query;
    const cached = getCached('/channel/dashboard/matrix', { period });
    if (cached) return res.json(cached);

    const { clause, params } = periodClause({ period });
    // Counted from the register so every level shows up; balance still from the
    // balance rows (only a distributor holds one in the IDC model).
    const stock = stockJoinOn('e.id', { period });
    // Dashboard dimensions exclude auto-created uplines so the operator sees
    // only what the file directly carried (retailer areas, retailer business
    // types, etc.).
    const present = entityPresenceDirect({ period });

    const [rows] = await pool.query(
      `SELECT d.code AS domain_code, d.name AS domain_name, d.sort_order AS domain_sort,
              c.level, c.code AS category_code, c.name AS category_label,
              COUNT(DISTINCT e.id) AS entities,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
         LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${stock.sql}
        WHERE ${present.sql}
        GROUP BY d.code, d.name, d.sort_order, c.level, c.code, c.name
        ORDER BY d.sort_order, c.level`,
      [...stock.params, ...present.params]
    );

    const [summaries] = await pool.query(
      `SELECT d.code AS domain_code, s.category_label, s.stock_balance, s.level
         FROM channel_stock_summary s JOIN channel_domains d ON d.id = s.domain_id
        WHERE s.period_month = (SELECT MAX(period_month) FROM channel_stock_balances)
           OR s.period_month = ?`,
      [normalizePeriod(period)]
    );

    const summaryByKey = {};
    for (const s of summaries) {
      const k = `${s.domain_code}|${String(s.level)}`;
      summaryByKey[k] = (summaryByKey[k] || 0) + Number(s.stock_balance);
    }

    const matrix = rows.map((r) => {
      const summary = summaryByKey[`${r.domain_code}|${r.level}`];
      return {
        domain_code: r.domain_code,
        domain_name: r.domain_name,
        level: r.level,
        category_code: r.category_code,
        category_label: r.category_label,
        entities: Number(r.entities),
        balance: round2(r.balance),
        summary_balance: summary === undefined ? null : round2(summary),
        variance: summary === undefined ? null : round2(summary - r.balance),
      };
    });

    const payload = {
      period: normalizePeriod(period) || (await latestPeriod()),
      // 'current' — every user's most recent stock; 'period' — the month asked for.
      scope: normalizePeriod(period) ? 'period' : 'current',
      rows: matrix,
      totals: {
        balance: round2(matrix.reduce((a, r) => a + r.balance, 0)),
        entities: matrix.reduce((a, r) => a + r.entities, 0),
        summary_balance: round2(matrix.filter((r) => r.summary_balance !== null).reduce((a, r) => a + r.summary_balance, 0)),
      },
      pivot: pivotByDomain(matrix),
    };

    setCached('/channel/dashboard/matrix', { period }, payload, 2 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function pivotByDomain(matrix) {
  const domains = {};
  for (const r of matrix) {
    domains[r.domain_code] = domains[r.domain_code] || { domain_code: r.domain_code, domain_name: r.domain_name, levels: {}, total: 0, entities: 0 };
    const d = domains[r.domain_code];
    d.levels[r.level] = {
      category_label: r.category_label,
      balance: r.balance,
      entities: r.entities,
      summary_balance: r.summary_balance,
    };
    d.total = round2(d.total + r.balance);
    d.entities += r.entities;
  }
  return Object.values(domains);
}

// ── GET /api/channel/dashboard/trend ───────────────────────────────────────

router.get('/dashboard/trend', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { from, to } = req.query;
    const cached = getCached('/channel/dashboard/trend', { from, to });
    if (cached) return res.json(cached);

    const where = [];
    const params = [];
    const f = normalizePeriod(from);
    const t = normalizePeriod(to);
    if (f) { where.push('b.period_month >= ?'); params.push(f); }
    if (t) { where.push('b.period_month <= ?'); params.push(t); }
    const clause = where.length ? where.join(' AND ') : '1 = 1';

    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(b.period_month, '%Y-%m-%d') AS period_month,
              COALESCE(SUM(b.available_balance), 0) AS balance,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance
         FROM channel_stock_balances b
        WHERE ${clause}
        GROUP BY b.period_month ORDER BY b.period_month`,
      params
    );

    // The periods themselves. Balance rows are one source; now that balance is
    // no longer imported the register's own first-seen months are the other, so
    // the growth line still has something to draw on an import-only system.
    const [periodRows] = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT DATE_FORMAT(period_month, '%Y-%m-01') AS period_month FROM channel_stock_balances
         UNION
         SELECT DISTINCT DATE_FORMAT(first_seen_period, '%Y-%m-01') AS period_month
           FROM channel_entities WHERE first_seen_period IS NOT NULL
       ) p ORDER BY period_month`
    );

    // Level counts per period come from the register, not from the balance rows:
    // a Sub-Distributor or Retailer never holds a balance of its own, so the old
    // balance-driven counts read zero for both once the IDC model was in place.
    const presentWhere = [];
    const presentParams = [];
    if (f) { presentWhere.push('per.period_month >= ?'); presentParams.push(f); }
    if (t) { presentWhere.push('per.period_month <= ?'); presentParams.push(t); }
    const [registryCounts] = await pool.query(
      `SELECT DATE_FORMAT(per.period_month, '%Y-%m-%d') AS period_month,
              COUNT(DISTINCT e.id) AS entities,
              COUNT(DISTINCT CASE WHEN c.level = 1 THEN e.id END) AS distributors,
              COUNT(DISTINCT CASE WHEN c.level = 2 THEN e.id END) AS sub_distributors,
              COUNT(DISTINCT CASE WHEN c.level = 3 THEN e.id END) AS retailers
         FROM (SELECT DISTINCT period_month FROM channel_stock_balances
               UNION
               SELECT DISTINCT first_seen_period AS period_month
                 FROM channel_entities WHERE first_seen_period IS NOT NULL) per
         JOIN channel_entities e
           ON COALESCE(e.first_seen_period, '1970-01-01') <= per.period_month
         JOIN channel_categories c ON c.id = e.category_id
        ${presentWhere.length ? `WHERE ${presentWhere.join(' AND ')}` : ''}
        GROUP BY per.period_month`,
      presentParams
    );
    const registryByPeriod = Object.fromEntries(registryCounts.map((r) => [String(r.period_month), r]));

    const [summary] = await pool.query(
      `SELECT DATE_FORMAT(period_month, '%Y-%m-%d') AS period_month, COALESCE(SUM(stock_balance), 0) AS balance
         FROM channel_stock_summary GROUP BY period_month ORDER BY period_month`
    );
    const summaryMap = Object.fromEntries(summary.map((s) => [String(s.period_month), round2(s.balance)]));

    // One row per period, whether or not it has balance rows behind it.
    const balanceByPeriod = Object.fromEntries(rows.map((r) => [String(r.period_month), r]));
    const payload = {
      trend: periodRows.map((p) => {
        const key = String(p.period_month);
        const r = balanceByPeriod[key] || { balance: 0, entities_with_balance: 0 };
        const reg = registryByPeriod[key] || {};
        return {
          period: key,
          balance: round2(r.balance),
          summary_balance: summaryMap[key] ?? null,
          // The chain as a whole (every level, uplines included) and the rows
          // the file carried itself — two different questions, both answered.
          entities: Number(reg.entities) || 0,
          entities_with_balance: Number(r.entities_with_balance) || 0,
          distributors: Number(reg.distributors) || 0,
          sub_distributors: Number(reg.sub_distributors) || 0,
          retailers: Number(reg.retailers) || 0,
        };
      }),
    };
    setCached('/channel/dashboard/trend', { from, to }, payload, 2 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/dashboard/top-distributors ────────────────────────────
// Ranked by an owner's own balance plus everything hanging underneath it.
//
// Driven by the OWNER link rather than the owner's own category level: the
// retailer extract carries the Distributor only as the "Owner User" column, so
// a level-1-only query would come back empty when no distributor file has been
// loaded. Anyone who owns downstream users is a distributor for ranking purposes.

router.get('/dashboard/top-distributors', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { period } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const cached = getCached('/channel/dashboard/top-distributors', { period, limit });
    if (cached) return res.json(cached);

    // Current stock by default, the named period when the caller picks one.
    const picked = normalizePeriod(period);
    const stockOf = (alias, entityExpr) => (picked
      ? `${alias}.period_month = ?`
      : `${alias}.period_month = (SELECT MAX(${alias}2.period_month) FROM channel_stock_balances ${alias}2 WHERE ${alias}2.entity_id = ${entityExpr})`);
    const periodParam = picked ? [picked] : [];

    const [rows] = await pool.query(
      `SELECT o.id, o.user_name, o.mobile_number,
              COALESCE(d.code, 'UNMAPPED') AS domain_code, COALESCE(d.name, 'Unmapped') AS domain_name,
              COALESCE(c.name, 'Uncategorized') AS category_label,
              COALESCE(own.available_balance, 0) AS own_balance,
              (SELECT COUNT(*) FROM channel_entities ch WHERE ch.owner_id = o.id AND ch.id <> o.id) AS downstream_entities,
              (SELECT COALESCE(SUM(cb.available_balance), 0)
                 FROM channel_stock_balances cb
                 JOIN channel_entities ch2 ON ch2.id = cb.entity_id
                WHERE ch2.owner_id = o.id AND ch2.id <> o.id AND ${stockOf('cb', 'cb.entity_id')}) AS downstream_balance
         FROM channel_entities o
         LEFT JOIN channel_categories c ON c.id = o.category_id
         LEFT JOIN channel_domains d ON d.id = c.domain_id
         LEFT JOIN channel_stock_balances own ON own.entity_id = o.id AND ${stockOf('own', 'o.id')}
        WHERE EXISTS (SELECT 1 FROM channel_entities ch3 WHERE ch3.owner_id = o.id AND ch3.id <> o.id)
        ORDER BY (COALESCE(own.available_balance, 0) + (SELECT COALESCE(SUM(cb.available_balance), 0)
                   FROM channel_stock_balances cb JOIN channel_entities ch4 ON ch4.id = cb.entity_id
                  WHERE ch4.owner_id = o.id AND ch4.id <> o.id AND ${stockOf('cb', 'cb.entity_id')})) DESC
        LIMIT ?`,
      [...periodParam, ...periodParam, ...periodParam, limit]
    );

    const payload = {
      scope: picked ? 'period' : 'current',
      distributors: rows.map((r) => {
        const own = round2(r.own_balance);
        const downstream = round2(r.downstream_balance);
        return {
          entity_id: r.id,
          user_name: r.user_name,
          mobile_number: r.mobile_number,
          domain_code: r.domain_code,
          domain_name: r.domain_name,
          category_label: r.category_label,
          own_balance: own,
          downstream_entities: Number(r.downstream_entities),
          downstream_balance: downstream,
          total_balance: round2(own + downstream),
        };
      }),
    };
    setCached('/channel/dashboard/top-distributors', { period, limit }, payload, 2 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/dashboard/geo ─────────────────────────────────────────

router.get('/dashboard/geo', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { period } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);
    const cached = getCached('/channel/dashboard/geo', { period, limit });
    if (cached) return res.json(cached);

    const stock = stockJoinOn('e.id', { period });
    const present = entityPresenceDirect({ period });

    const [rows] = await pool.query(
      `SELECT COALESCE(g.area_name, e.geo_domain_raw, 'Unspecified') AS area,
              COALESCE(g.region, e.geo_domain_raw, 'Unspecified') AS region_raw,
              COUNT(DISTINCT e.id) AS entities,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         LEFT JOIN channel_geo_aliases g ON g.raw_value = e.geo_domain_raw
         LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${stock.sql}
        WHERE ${present.sql}
        GROUP BY area, region_raw
        ORDER BY entities DESC, balance DESC LIMIT ?`,
      [...stock.params, ...present.params, limit]
    );

    const [total] = await pool.query(
      `SELECT COUNT(DISTINCT e.geo_domain_raw) AS areas FROM channel_entities e
        WHERE ${present.sql} AND e.geo_domain_raw IS NOT NULL`,
      present.params
    );

    const payload = {
      areas: rows.map((r) => ({ area: r.area, entities: Number(r.entities), balance: round2(r.balance) })),
      distinct_areas: Number(total[0].areas),
      note: 'Geographical values are grouped as they appear in the source file until mapped in channel_geo_aliases.',
    };
    setCached('/channel/dashboard/geo', { period, limit }, payload, 2 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/reports/level ─────────────────────────────────────────
/**
 * One report per hierarchy level: Distributor (1), Sub-Distributor (2),
 * Retailer (3).
 *
 * Driven from channel_entities with a LEFT JOIN onto the period's balance —
 * deliberately, because every balance-driven dashboard query inner-joins
 * channel_stock_balances, which makes a level invisible whenever its members
 * hold no balance row for the period. A Distributor with only downstream stock
 * would otherwise report as zero entities.
 *
 * `parent_id` drills down: for a Sub-Distributor it filters on their
 * Distributor, for a Retailer on their Sub-Distributor.
 */
router.get('/reports/level', async (req, res) => {
  try {
    await ensureChannelSchema();
    const level = Math.min(Math.max(parseInt(req.query.level, 10) || 3, 1), 3);
    const { category, status, search, parent_id: parentId } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
    const offset = (page - 1) * limit;

    // Current stock unless a period is named. Current stock needs no stored
    // period to exist — every entity is listed with whatever stock it last had,
    // zero when it has none — so there is no empty-report short-circuit left.
    const requestedPeriod = normalizePeriod(req.query.period);
    const balanceBasis = requestedPeriod ? 'period' : 'current';
    const balanceJoin = requestedPeriod
      ? { sql: 'LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND b.period_month = ?', params: [requestedPeriod] }
      : { sql: `LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${currentStockOf('e.id')}`, params: [] };
    const downstreamStockSql = requestedPeriod
      ? 'cb.period_month = ?'
      : 'cb.period_month = (SELECT MAX(cb2.period_month) FROM channel_stock_balances cb2 WHERE cb2.entity_id = cb.entity_id)';
    const downstreamStockParams = requestedPeriod ? [requestedPeriod] : [];
    // A Sub-Distributor or Retailer holds no stock of its own — the IDC extract
    // carries the Distributor's figure on every row — so the report shows the
    // stock their Distributor holds, which is what the operator edits.
    const ownerStockSql = requestedPeriod
      ? 'ob.period_month = ?'
      : 'ob.period_month = (SELECT MAX(ob2.period_month) FROM channel_stock_balances ob2 WHERE ob2.entity_id = ob.entity_id)';
    const ownerStockParams = requestedPeriod ? [requestedPeriod] : [];
    const periodValue = requestedPeriod;

    const where = ['c.level = ?'];
    const params = [level];
    if (category) { where.push('c.code = ?'); params.push(category); }
    if (status) { where.push('e.status = ?'); params.push(status); }
    if (search) {
      where.push('(e.user_name LIKE ? OR e.mobile_number LIKE ? OR e.geo_domain_raw LIKE ? OR e.business_type LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (parentId) {
      // A Retailer's upline is its Sub-Distributor; anything else hangs off its
      // Distributor.
      where.push(level === 3 ? 'e.parent_id = ?' : 'e.owner_id = ?');
      params.push(Number(parentId));
    }
    const whereSql = where.join(' AND ');

    const [summaryRows] = await pool.query(
      `SELECT COUNT(DISTINCT e.id) AS entities,
              SUM(e.status = 'active') AS active_entities,
              SUM(e.status = 'canceled') AS canceled_entities,
              SUM(e.status = 'inactive') AS inactive_entities,
              COUNT(DISTINCT e.geo_domain_raw) AS areas,
              COUNT(DISTINCT b.entity_id) AS entities_with_balance,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         ${balanceJoin.sql}
        WHERE ${whereSql}`,
      [...balanceJoin.params, ...params]
    );

    const dimensionSql = (column) => `SELECT COALESCE(NULLIF(${column}, ''), 'Unspecified') AS label,
              COUNT(DISTINCT e.id) AS entities,
              COALESCE(SUM(b.available_balance), 0) AS balance
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         ${balanceJoin.sql}
        WHERE ${whereSql}
        GROUP BY label ORDER BY balance DESC LIMIT 50`;

    const [byProduct] = await pool.query(dimensionSql('e.product'), [...balanceJoin.params, ...params]);
    const [byBusiness] = await pool.query(dimensionSql('e.business_type'), [...balanceJoin.params, ...params]);

    // Two steps on purpose. The registry holds hundreds of thousands of rows, and
    // a single statement cannot both ORDER BY a joined balance across all of them
    // and run four correlated subqueries per candidate row — that is a full scan
    // times four. Paging first is a plain join + filesort; the per-entity counts
    // then run for at most `limit` ids.
    const [pageRows] = await pool.query(
      `SELECT e.id, COALESCE(b.available_balance, 0) AS balance
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         ${balanceJoin.sql}
        WHERE ${whereSql}
        ORDER BY COALESCE(b.available_balance, 0) DESC, e.user_name
        LIMIT ? OFFSET ?`,
      [...balanceJoin.params, ...params, limit, offset]
    );

    const ids = pageRows.map((r) => r.id);
    let rows = [];
    if (ids.length) {
      const [detail] = await pool.query(
        `SELECT e.id, e.mobile_number, e.user_name, e.status, e.geo_domain_raw,
                e.business_type, e.tin, e.location, e.national_id, e.product, e.source,
                e.woreda, e.sub_city, e.house_no, e.trade_name, e.photo_keywords,
                e.identifier_code, e.import_code,
                DATE_FORMAT(e.imported_at, '%Y-%m-%d %H:%i') AS imported_at,
                DATE_FORMAT(e.first_seen_period, '%Y-%m-%d') AS first_seen_period,
                DATE_FORMAT(e.last_seen_period, '%Y-%m-%d') AS last_seen_period,
                c.code AS category_code, c.name AS category_label, c.level,
                d.code AS domain_code, d.name AS domain_name,
                p.user_name AS parent_name, p.mobile_number AS parent_mobile,
                o.user_name AS owner_name, o.mobile_number AS owner_mobile,
                COALESCE(b.available_balance, 0) AS balance,
                DATE_FORMAT(b.period_month, '%Y-%m-%d') AS balance_period,
                b.entity_id IS NOT NULL AS has_balance,
                (SELECT COUNT(*) FROM channel_entities ch
                   JOIN channel_categories cc ON cc.id = ch.category_id
                  WHERE ch.owner_id = e.id AND ch.id <> e.id AND cc.level = 2) AS sub_distributors,
                (SELECT COUNT(*) FROM channel_entities ch
                   JOIN channel_categories cc ON cc.id = ch.category_id
                  WHERE ${level === 2 ? 'ch.parent_id = e.id' : 'ch.owner_id = e.id'}
                    AND ch.id <> e.id AND cc.level = 3) AS retailers,
                (SELECT COUNT(*) FROM channel_entities ch
                  WHERE ch.parent_id = e.id AND ch.id <> e.id) AS direct_children,
                (SELECT COALESCE(SUM(cb.available_balance), 0)
                   FROM channel_stock_balances cb
                   JOIN channel_entities ch2 ON ch2.id = cb.entity_id
                  WHERE ch2.owner_id = e.id AND ch2.id <> e.id AND ${downstreamStockSql}) AS downstream_balance,
                (SELECT COALESCE(SUM(ob.available_balance), 0)
                   FROM channel_stock_balances ob
                  WHERE ob.entity_id = e.owner_id AND ${ownerStockSql}) AS owner_balance,
                (SELECT DATE_FORMAT(MAX(ob.period_month), '%Y-%m-%d')
                   FROM channel_stock_balances ob
                  WHERE ob.entity_id = e.owner_id AND ${ownerStockSql}) AS owner_balance_period
           FROM channel_entities e
           JOIN channel_categories c ON c.id = e.category_id
           JOIN channel_domains d ON d.id = c.domain_id
           LEFT JOIN channel_entities p ON p.id = e.parent_id
           LEFT JOIN channel_entities o ON o.id = e.owner_id
           ${balanceJoin.sql}
          WHERE e.id IN (${ids.map(() => '?').join(',')})`,
        [...downstreamStockParams, ...ownerStockParams, ...ownerStockParams, ...balanceJoin.params, ...ids]
      );
      // Restore the page's ranking, which the detail query does not preserve.
      const rank = new Map(ids.map((id, i) => [id, i]));
      rows = detail.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    }

    const s = summaryRows[0] || {};
    const total = Number(s.entities) || 0;
    const balance = round2(s.balance);
    const dim = (row) => ({ ...row, entities: Number(row.entities), balance: round2(row.balance) });

    res.json({
      level,
      level_label: LEVEL_LABELS[level],
      period: periodValue,
      // 'current' — each user's most recent stock (the default); 'period' — the
      // month the caller asked for.
      balance_basis: balanceBasis,
      summary: {
        entities: total,
        active_entities: Number(s.active_entities) || 0,
        canceled_entities: Number(s.canceled_entities) || 0,
        inactive_entities: Number(s.inactive_entities) || 0,
        areas: Number(s.areas) || 0,
        entities_with_balance: Number(s.entities_with_balance) || 0,
        balance,
        avg_balance: total ? round2(balance / total) : 0,
      },
      by_product: byProduct.map(dim),
      by_business_type: byBusiness.map(dim),
      rows: rows.map((r) => ({
        ...r,
        balance: round2(r.balance),
        downstream_balance: round2(r.downstream_balance),
        // Stock held by this user's Distributor — the figure a level-2 or
        // level-3 row is really measured by.
        owner_balance: round2(r.owner_balance),
        // Which import wrote this row, and when — the audit trail an operator
        // quotes when asking about a record.
        import_code: r.import_code || null,
        imported_at: r.imported_at || null,
        total_balance: round2(Number(r.balance) + Number(r.downstream_balance)),
        has_balance: Boolean(r.has_balance),
        sub_distributors: Number(r.sub_distributors) || 0,
        retailers: Number(r.retailers) || 0,
        direct_children: Number(r.direct_children) || 0,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/reports/retailer-coverage ─────────────────────────────
/**
 * How far the retailer base actually reaches.
 *
 * Three questions an operator asks of a register: which areas carry a retailer,
 * which areas carry users but no retailer yet (the gaps worth opening), and how
 * much of the upline chain has a retailer under it. All of it is counted from
 * the registry with the same period-presence rule the dashboard uses, so a
 * coverage figure never trails the register it describes.
 */
router.get('/reports/retailer-coverage', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { period, from, to } = req.query;
    const cached = getCached('/channel/reports/retailer-coverage', { period, from, to });
    if (cached) return res.json(cached);

    const present = entityPresence({ period, from, to });
    const presentDirect = entityPresenceDirect({ period, from, to });
    // The same presence predicate, retargeted at an aliased copy of the registry
    // (entityPresence hardcodes the `e.` alias).
    const forAlias = (base, alias) => ({
      sql: base.sql.replace(/\be\./g, `${alias}.`),
      params: base.params,
    });

    const [summary] = await pool.query(
      `SELECT COUNT(*) AS retailers,
              SUM(e.status = 'active') AS active_entities,
              SUM(e.status = 'canceled') AS canceled_entities,
              SUM(e.status = 'inactive') AS inactive_entities,
              COUNT(DISTINCT NULLIF(e.geo_domain_raw, '')) AS areas_with_retailers
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
        WHERE c.level = 3 AND ${present.sql}`,
      present.params
    );

    const [byArea] = await pool.query(
      `SELECT COALESCE(NULLIF(e.geo_domain_raw, ''), 'Unspecified') AS area,
              COUNT(*) AS retailers,
              SUM(e.status = 'active') AS active_entities
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
        WHERE c.level = 3 AND ${present.sql}
        GROUP BY area
        ORDER BY retailers DESC, area LIMIT 500`,
      present.params
    );

    // Every area the register directly carries — the denominator the gaps are
    // measured against.
    const [allAreas] = await pool.query(
      `SELECT COALESCE(NULLIF(e.geo_domain_raw, ''), 'Unspecified') AS area,
              COUNT(DISTINCT e.id) AS entities
         FROM channel_entities e
        WHERE ${presentDirect.sql}
        GROUP BY area
        ORDER BY entities DESC, area LIMIT 500`,
      presentDirect.params
    );

    const [byDomain] = await pool.query(
      `SELECT d.code AS domain_code, d.name AS domain_name,
              COUNT(*) AS retailers,
              SUM(e.status = 'active') AS active_entities
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
        WHERE c.level = 3 AND ${present.sql}
        GROUP BY d.code, d.name, d.sort_order ORDER BY d.sort_order`,
      present.params
    );

    // A distributor (or Sub-Distributor) is "covered" when at least one retailer
    // hangs under it.
    const distPresence = forAlias(present, 'd');
    const [distributors] = await pool.query(
      `SELECT COUNT(DISTINCT d.id) AS total,
              COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN d.id END) AS covered
         FROM channel_entities d
         JOIN channel_categories dc ON dc.id = d.category_id AND dc.level = 1
         LEFT JOIN channel_entities r ON r.owner_id = d.id
         LEFT JOIN channel_categories rc ON rc.id = r.category_id AND rc.level = 3
        WHERE ${distPresence.sql}`,
      distPresence.params
    );

    const subPresence = forAlias(present, 's');
    const [subDistributors] = await pool.query(
      `SELECT COUNT(DISTINCT s.id) AS total,
              COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN s.id END) AS covered
         FROM channel_entities s
         JOIN channel_categories sc ON sc.id = s.category_id AND sc.level = 2
         LEFT JOIN channel_entities r ON r.parent_id = s.id
         LEFT JOIN channel_categories rc ON rc.id = r.category_id AND rc.level = 3
        WHERE ${subPresence.sql}`,
      subPresence.params
    );

    const retailerAreas = new Set(byArea.map((r) => r.area));
    const gaps = allAreas
      .filter((a) => !retailerAreas.has(a.area))
      .map((a) => ({ area: a.area, entities: Number(a.entities) }));

    const payload = {
      level: 3,
      summary: {
        retailers: Number(summary[0].retailers) || 0,
        active_entities: Number(summary[0].active_entities) || 0,
        canceled_entities: Number(summary[0].canceled_entities) || 0,
        inactive_entities: Number(summary[0].inactive_entities) || 0,
        areas_with_retailers: Number(summary[0].areas_with_retailers) || 0,
        total_areas: allAreas.length,
      },
      by_area: byArea.map((r) => ({
        area: r.area,
        retailers: Number(r.retailers) || 0,
        active_entities: Number(r.active_entities) || 0,
      })),
      gaps,
      by_domain: byDomain.map((r) => ({
        ...r,
        retailers: Number(r.retailers) || 0,
        active_entities: Number(r.active_entities) || 0,
      })),
      upline: {
        distributors: { total: Number(distributors[0].total) || 0, covered: Number(distributors[0].covered) || 0 },
        sub_distributors: { total: Number(subDistributors[0].total) || 0, covered: Number(subDistributors[0].covered) || 0 },
      },
      note: 'A retailer covers an area when the register places at least one there; gaps are areas that carry users but no retailer.',
    };
    setCached('/channel/reports/retailer-coverage', { period, from, to }, payload, 2 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/entities ──────────────────────────────────────────────

router.get('/entities', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { search, domain, category, level, status, geo, period, import_code: importCode } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const offset = (page - 1) * limit;

    // Current stock by default, the named period when the caller picks one.
    const requestedPeriod = normalizePeriod(period);
    const balanceJoin = requestedPeriod
      ? { sql: 'LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND b.period_month = ?', params: [requestedPeriod] }
      : { sql: `LEFT JOIN channel_stock_balances b ON b.entity_id = e.id AND ${currentStockOf('e.id')}`, params: [] };

    const where = [];
    const params = [];
    if (search) {
      where.push('(e.user_name LIKE ? OR e.mobile_number LIKE ? OR e.parent_mobile LIKE ? OR e.owner_mobile LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (domain) { where.push('d.code = ?'); params.push(domain); }
    if (category) { where.push('c.code = ?'); params.push(category); }
    if (level) { where.push('c.level = ?'); params.push(Number(level)); }
    if (status) { where.push('e.status = ?'); params.push(status); }
    if (geo) { where.push('e.geo_domain_raw = ?'); params.push(geo); }
    // "Show me exactly what this import brought in" — the audit view of one run.
    if (importCode) { where.push('e.import_code = ?'); params.push(String(importCode)); }
    const whereSql = where.length ? where.join(' AND ') : '1 = 1';

    const [rows] = await pool.query(
      `SELECT e.id, e.mobile_number, e.user_name, e.status, e.geo_domain_raw, e.product,
              e.business_type, e.tin, e.location, e.national_id,
              e.parent_mobile, e.owner_mobile, e.parent_id, e.owner_id, e.source,
              e.identifier_code, e.import_code,
              DATE_FORMAT(e.imported_at, '%Y-%m-%d %H:%i') AS imported_at,
              DATE_FORMAT(e.first_seen_period, '%Y-%m-%d') AS first_seen_period,
              DATE_FORMAT(e.last_seen_period, '%Y-%m-%d') AS last_seen_period,
              c.code AS category_code, c.name AS category_label, c.level,
              d.code AS domain_code, d.name AS domain_name,
              p.user_name AS parent_name, o.user_name AS owner_name,
              b.available_balance,
              DATE_FORMAT(b.period_month, '%Y-%m-%d') AS period_month
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
         LEFT JOIN channel_entities p ON p.id = e.parent_id
         LEFT JOIN channel_entities o ON o.id = e.owner_id
         ${balanceJoin.sql}
        WHERE ${whereSql}
        ORDER BY b.available_balance IS NULL, b.available_balance DESC, e.user_name
        LIMIT ? OFFSET ?`,
      [...balanceJoin.params, ...params, limit, offset]
    );

    const [count] = await pool.query(
      `SELECT COUNT(*) AS total FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
        WHERE ${whereSql}`,
      params
    );

    res.json({
      entities: rows,
      pagination: { page, limit, total: Number(count[0].total), pages: Math.ceil(Number(count[0].total) / limit) },
      period: requestedPeriod,
      balance_basis: requestedPeriod ? 'period' : 'current',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/entities/lookup ──────────────────────────────────────
// Resolves a mobile number to its registry entry so the registration form can
// show the Parent Name / Owner User that the source workbook carries alongside
// the mobile. Registered before /entities/:id so "lookup" is not read as an id.

router.get('/entities/lookup', async (req, res) => {
  try {
    await ensureChannelSchema();
    const mobile = normalizeMobileForStore(req.query.mobile);
    if (!mobile) return res.status(400).json({ error: 'A valid mobile number is required' });

    const [rows] = await pool.query(
      `SELECT e.id, e.mobile_number, e.user_name, e.status, e.geo_domain_raw, e.product,
              c.code AS category_code, c.name AS category_label, c.level,
              d.code AS domain_code, d.name AS domain_name
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
        WHERE e.mobile_number = ?`,
      [mobile]
    );
    if (!rows.length) return res.status(404).json({ error: 'No channel user with that mobile number', mobile });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/entities/select-options ───────────────────────────────
/**
 * The closed lists the registration form chooses an upline from, with enough of
 * each candidate's profile to fill the whole form in from the selection rather
 * than making the operator retype what the registry already knows.
 *
 * Registered before /entities/:id so "select-options" is not read as an id.
 */
router.get('/entities/select-options', async (req, res) => {
  try {
    await ensureChannelSchema();
    const level = parseInt(req.query.level, 10);
    const where = [];
    const params = [];
    if (level) { where.push('c.level = ?'); params.push(level); }
    if (req.query.domain) { where.push('d.code = ?'); params.push(req.query.domain); }
    if (req.query.status) { where.push('e.status = ?'); params.push(req.query.status); }

    const [rows] = await pool.query(
      `SELECT e.id, e.mobile_number, e.user_name, e.status, e.geo_domain_raw,
              e.business_type, e.product, e.parent_mobile, e.owner_mobile,
              c.code AS category_code, c.name AS category_label, c.level,
              d.code AS domain_code, d.name AS domain_name,
              p.user_name AS parent_name, p.mobile_number AS parent_mobile_of_parent,
              o.user_name AS owner_name, o.mobile_number AS owner_mobile_of_owner,
              COALESCE(dc.downstream_entities, 0) AS downstream_entities
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
         LEFT JOIN channel_entities p ON p.id = e.parent_id
         LEFT JOIN channel_entities o ON o.id = e.owner_id
         -- Direct reports, counted once for the whole result rather than once
         -- per candidate row. The registry holds ~200k entities, so the old
         -- correlated subquery (parent_id OR owner_id = e.id) ran 200k times
         -- and never returned, leaving the picker spinning forever. Both
         -- directions are index reads here, and COUNT(DISTINCT) keeps a row
         -- that is both the parent and the owner of the same entity counted
         -- once, which is the semantics the subquery had.
         LEFT JOIN (
           SELECT up_id, COUNT(DISTINCT ent_id) AS downstream_entities
             FROM (
               SELECT parent_id AS up_id, id AS ent_id
                 FROM channel_entities WHERE parent_id IS NOT NULL
               UNION ALL
               SELECT owner_id AS up_id, id AS ent_id
                 FROM channel_entities WHERE owner_id IS NOT NULL
             ) links
            GROUP BY up_id
         ) dc ON dc.up_id = e.id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY e.user_name LIMIT 2000`,
      params
    );

    res.json({
      level: level || null,
      options: rows.map((r) => ({ ...r, downstream_entities: Number(r.downstream_entities) || 0 })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/entities/:id ──────────────────────────────────────────

router.get('/entities/:id', async (req, res) => {
  try {
    await ensureChannelSchema();
    // The batch joins on `last_batch_id` for the filename: the code and the
    // moment of import are stamped on the row itself, but the workbook's name
    // only lives on the batch.
    const [rows] = await pool.query(
      `SELECT e.*, c.code AS category_code, c.name AS category_label, c.level,
              d.code AS domain_code, d.name AS domain_name,
              p.user_name AS parent_name, o.user_name AS owner_name,
              DATE_FORMAT(e.imported_at, '%Y-%m-%d %H:%i') AS imported_at,
              ib.filename AS import_filename,
              DATE_FORMAT(ib.created_at, '%Y-%m-%d %H:%i') AS import_run_at,
              fb.import_code AS first_import_code
         FROM channel_entities e
         JOIN channel_categories c ON c.id = e.category_id
         JOIN channel_domains d ON d.id = c.domain_id
         LEFT JOIN channel_entities p ON p.id = e.parent_id
         LEFT JOIN channel_entities o ON o.id = e.owner_id
         LEFT JOIN channel_import_batches ib ON ib.id = e.last_batch_id
         LEFT JOIN channel_import_batches fb ON fb.id = e.first_batch_id
        WHERE e.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Channel entity not found' });

    const [history] = await pool.query(
      "SELECT DATE_FORMAT(period_month, '%Y-%m-%d') AS period_month, product, available_balance, source FROM channel_stock_balances WHERE entity_id = ? ORDER BY period_month DESC, product",
      [req.params.id]
    );
    const [children] = await pool.query(
      `SELECT e.id, e.user_name, e.mobile_number, e.status, c.name AS category_label, c.level,
              (SELECT available_balance FROM channel_stock_balances cb WHERE cb.entity_id = e.id ORDER BY period_month DESC LIMIT 1) AS latest_balance
         FROM channel_entities e JOIN channel_categories c ON c.id = e.category_id
        WHERE e.parent_id = ? OR e.owner_id = ?
        ORDER BY c.level, e.user_name LIMIT 300`,
      [req.params.id, req.params.id]
    );

    res.json({ entity: rows[0], balance_history: history, children });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/channel/tin-verify/:tin — eTrade & MoR TIN verification ────────

router.get('/tin-verify/:tin', async (req, res) => {
  try {
    const rawTin = String(req.params.tin || '').trim().replace(/\D/g, '');
    if (!rawTin || rawTin.length < 8) {
      return res.status(400).json({ error: 'Please provide a valid TIN number (minimum 8-10 digits)' });
    }
    const tin = rawTin.padStart(10, '0');

    // Query Ministry of Revenue (MoR) checkTin from eTrade
    const tinRes = await fetchEtradeJson(`api/Tin/checkTin/${encodeURIComponent(tin)}`);

    if (!tinRes || tinRes.status !== 200 || !Array.isArray(tinRes.data) || tinRes.data.length === 0) {
      return res.json({
        found: false,
        tin,
        message: 'TIN not found in eTrade / Ministry of Revenue records',
      });
    }

    const item = tinRes.data[0];

    // Format mobile if returned with 251 prefix
    let mobile = (item.MOBILE_PHONE || item.PHONE_NO || '').trim();
    if (mobile.startsWith('251')) {
      mobile = '0' + mobile.slice(3);
    }

    // Trade name: english name or fallback to Amharic
    const tradeNameEng = (item.FIRSTNAME || '').trim();
    const tradeNameAmh = (item.FIRSTNAME_F || item.FIRSTNAME_S || '').trim();
    const tradeName = tradeNameEng || tradeNameAmh;

    const woreda = (item.LOCALITY_DESC || item.KEBELE_DESC || '').trim();
    const subCity = (item.CITY_NAME || '').trim();
    const parishName = (item.PARISH_NAME || '').trim();
    const geoDomain = parishName || subCity;
    const houseNo = (item.HOUSE_NO || '').trim();

    // Composed location string: Sub-City, Woreda, House No
    const locationParts = [subCity, woreda, houseNo ? `House: ${houseNo}` : ''].filter(Boolean);
    const location = locationParts.join(', ');

    const payload = {
      found: true,
      tin: item.CMP_TIN || tin,
      trade_name: tradeName,
      trade_name_eng: tradeNameEng,
      trade_name_amh: tradeNameAmh,
      mobile_phone: mobile,
      parish_name: parishName,
      geo_domain: geoDomain,
      sub_city: subCity,
      woreda,
      house_no: houseNo,
      location,
      tax_centre: (item.TAX_CENTRE_DESC || '').trim(),
      email: (item.ADDRESS_E_MAIL || '').trim(),
      entity_type: (item.ENT_TYPE_DESC || '').trim(),
      entry_date: item.ENTRY_DATE || null,
    };

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/channel/entities/:id/verify-tin — single entity TIN verify & sync
router.post('/entities/:id/verify-tin', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { overwrite = false, tin: passedTin } = req.body || {};
    const [rows] = await pool.query('SELECT * FROM channel_entities WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Channel entity not found' });
    const entity = rows[0];

    const targetTin = String(passedTin || entity.tin || '').trim().replace(/\D/g, '');
    if (!targetTin || targetTin.length < 8) {
      return res.status(400).json({ error: 'This record does not have a valid TIN number to verify' });
    }
    const cleanTin = targetTin.padStart(10, '0');

    const tinRes = await fetchEtradeJson(`api/Tin/checkTin/${encodeURIComponent(cleanTin)}`);

    if (!tinRes || tinRes.status !== 200 || !Array.isArray(tinRes.data) || tinRes.data.length === 0) {
      return res.json({
        found: false,
        tin: cleanTin,
        message: 'TIN not found in eTrade / Ministry of Revenue records',
      });
    }

    const item = tinRes.data[0];

    let mobile = (item.MOBILE_PHONE || item.PHONE_NO || '').trim();
    if (mobile.startsWith('251')) mobile = '0' + mobile.slice(3);

    const tradeNameEng = (item.FIRSTNAME || '').trim();
    const tradeNameAmh = (item.FIRSTNAME_F || item.FIRSTNAME_S || '').trim();
    const tradeName = tradeNameEng || tradeNameAmh;

    const woreda = (item.LOCALITY_DESC || item.KEBELE_DESC || '').trim();
    const subCity = (item.CITY_NAME || '').trim();
    const parishName = (item.PARISH_NAME || '').trim();
    const geoDomain = parishName || subCity;
    const houseNo = (item.HOUSE_NO || '').trim();

    const locationParts = [subCity, woreda, houseNo ? `House: ${houseNo}` : ''].filter(Boolean);
    const location = locationParts.join(', ');

    // Update the database record
    if (overwrite) {
      await pool.query(
        `UPDATE channel_entities
            SET tin = ?,
                user_name = COALESCE(NULLIF(?, ''), user_name),
                geo_domain_raw = COALESCE(NULLIF(?, ''), geo_domain_raw),
                location = COALESCE(NULLIF(?, ''), location),
                trade_name = ?,
                woreda = ?,
                sub_city = ?,
                house_no = ?
          WHERE id = ?`,
        [
          cleanTin,
          tradeName,
          geoDomain,
          location,
          tradeName,
          woreda,
          subCity,
          houseNo,
          req.params.id,
        ]
      );
    } else {
      await pool.query(
        `UPDATE channel_entities
            SET tin = ?,
                trade_name = ?,
                woreda = ?,
                sub_city = ?,
                house_no = ?,
                location = IF(location IS NULL OR location = '', ?, location),
                geo_domain_raw = IF(geo_domain_raw IS NULL OR geo_domain_raw = '', ?, geo_domain_raw)
          WHERE id = ?`,
        [
          cleanTin,
          tradeName,
          woreda,
          subCity,
          houseNo,
          location,
          geoDomain,
          req.params.id,
        ]
      );
    }

    invalidate('/channel');

    res.json({
      success: true,
      found: true,
      overwritten: Boolean(overwrite),
      data: {
        tin: cleanTin,
        trade_name: tradeName,
        trade_name_amh: tradeNameAmh,
        parish_name: parishName,
        geo_domain: geoDomain,
        sub_city: subCity,
        woreda,
        house_no: houseNo,
        location,
      },
      message: `TIN ${cleanTin} verified with eTrade / Ministry of Revenue`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/channel/tin-verify/batch — batch verify imported records ──────
router.post('/tin-verify/batch', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { overwrite = false, entity_ids, limit = 100 } = req.body || {};

    let sql = `SELECT id, tin, user_name, geo_domain_raw, location
                 FROM channel_entities
                WHERE tin IS NOT NULL AND tin != ''`;
    const params = [];

    if (Array.isArray(entity_ids) && entity_ids.length > 0) {
      sql += ` AND id IN (${entity_ids.map(() => '?').join(',')})`;
      params.push(...entity_ids);
    } else {
      sql += ' ORDER BY id DESC LIMIT ?';
      params.push(Number(limit) || 100);
    }

    const [entities] = await pool.query(sql, params);
    if (!entities.length) {
      return res.json({ total: 0, verified: 0, failed: 0, message: 'No records with TIN found to verify' });
    }

    const results = [];
    let verifiedCount = 0;
    let failedCount = 0;

    for (const ent of entities) {
      const rawTin = String(ent.tin).replace(/\D/g, '');
      if (rawTin.length < 8) {
        failedCount++;
        results.push({ id: ent.id, tin: ent.tin, success: false, reason: 'Invalid TIN format' });
        continue;
      }
      const cleanTin = rawTin.padStart(10, '0');

      try {
        const tinRes = await fetchEtradeJson(`api/Tin/checkTin/${encodeURIComponent(cleanTin)}`);

        if (tinRes && tinRes.status === 200 && Array.isArray(tinRes.data) && tinRes.data.length > 0) {
          const item = tinRes.data[0];

          const tradeName = (item.FIRSTNAME || item.FIRSTNAME_F || '').trim();
          const woreda = (item.LOCALITY_DESC || item.KEBELE_DESC || '').trim();
          const subCity = (item.CITY_NAME || '').trim();
          const parishName = (item.PARISH_NAME || '').trim();
          const geoDomain = parishName || subCity;
          const houseNo = (item.HOUSE_NO || '').trim();
          const location = [subCity, woreda, houseNo ? `House: ${houseNo}` : ''].filter(Boolean).join(', ');

          if (overwrite) {
            await pool.query(
              `UPDATE channel_entities
                  SET tin = ?,
                      user_name = COALESCE(NULLIF(?, ''), user_name),
                      geo_domain_raw = COALESCE(NULLIF(?, ''), geo_domain_raw),
                      location = COALESCE(NULLIF(?, ''), location),
                      trade_name = ?,
                      woreda = ?,
                      sub_city = ?,
                      house_no = ?
                WHERE id = ?`,
              [cleanTin, tradeName, geoDomain, location, tradeName, woreda, subCity, houseNo, ent.id]
            );
          } else {
            await pool.query(
              `UPDATE channel_entities
                  SET tin = ?,
                      trade_name = ?,
                      woreda = ?,
                      sub_city = ?,
                      house_no = ?,
                      location = IF(location IS NULL OR location = '', ?, location),
                      geo_domain_raw = IF(geo_domain_raw IS NULL OR geo_domain_raw = '', ?, geo_domain_raw)
                WHERE id = ?`,
              [cleanTin, tradeName, woreda, subCity, houseNo, location, geoDomain, ent.id]
            );
          }

          verifiedCount++;
          results.push({
            id: ent.id,
            tin: cleanTin,
            success: true,
            trade_name: tradeName,
            geo_domain: geoDomain,
          });
        } else {
          failedCount++;
          results.push({ id: ent.id, tin: cleanTin, success: false, reason: 'Not found on eTrade' });
        }
      } catch (e) {
        failedCount++;
        results.push({ id: ent.id, tin: cleanTin, success: false, error: e.message });
      }
    }

    invalidate('/channel');

    res.json({
      total: entities.length,
      verified: verifiedCount,
      failed: failedCount,
      overwritten: Boolean(overwrite),
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/channel/entities — single registration ───────────────────────

router.post('/entities', async (req, res) => {
  try {
    await ensureChannelSchema();
    const b = req.body || {};

    const mobile = normalizeMobileForStore(b.mobile_number);
    if (!mobile) return res.status(400).json({ error: 'A valid mobile number is required' });
    const userName = String(b.user_name || '').trim().replace(/\s+/g, ' ');
    if (!userName) return res.status(400).json({ error: 'User name is required' });

    const category = await resolveCategory(b.category_code || b.category_id);
    if (!category) return res.status(400).json({ error: 'A valid category is required' });

    const [dupe] = await pool.query('SELECT id FROM channel_entities WHERE mobile_number = ?', [mobile]);
    if (dupe.length) {
      return res.status(409).json({ error: `Mobile ${mobile} is already registered`, entity_id: dupe[0].id });
    }

    const parentMobile = normalizeMobileForStore(b.parent_mobile);
    const ownerMobile = normalizeMobileForStore(b.owner_mobile);

    // ── IDC closed-list rule ──
    // Inside the Indirect Channel the uplines are picked from the registry, so a
    // Sub-Distributor must hang off a registered Distributor and a Retailer off
    // both a registered Sub-Distributor and one. The form only offers registered
    // users; this is the actual enforcement. Other domains keep their existing
    // free-form behaviour.
    if (category.domain_code === 'IDC') {
      if (category.level > 1 && !ownerMobile) {
        return res.status(400).json({ error: 'Select the Distributor this user belongs to', field: 'owner_mobile' });
      }
      if (category.level > 2 && !parentMobile) {
        return res.status(400).json({ error: 'Select the Sub Distributor this retailer belongs to', field: 'parent_mobile' });
      }
    }

    const { parentId, ownerId } = await resolveLinks(parentMobile, ownerMobile);
    if (parentMobile && !parentId) {
      return res.status(400).json({ error: `No registered channel user has mobile ${parentMobile}`, field: 'parent_mobile' });
    }
    if (ownerMobile && !ownerId) {
      return res.status(400).json({ error: `No registered channel user has mobile ${ownerMobile}`, field: 'owner_mobile' });
    }

    const period = normalizePeriod(b.period_month) || (await latestPeriod()) || new Date().toISOString().slice(0, 8) + '01';

    // Retailer-only compliance details. All are optional and stay null on
    // a Distributor or Sub-Distributor, which carry none of them.
    const tin = text(b.tin, 50);
    const location = text(b.location, 255);
    const nationalId = text(b.national_id, 50);
    const woreda = text(b.woreda, 150);
    const subCity = text(b.sub_city, 150);
    const houseNo = text(b.house_no, 100);
    const tradeName = text(b.trade_name, 255);
    const photoKeywords = text(b.photo_keywords || b.photo?.keywords, 255);

    const [result] = await pool.query(
      `INSERT INTO channel_entities
         (mobile_number, user_name, category_id, status, geo_domain_raw, product,
          business_type, parent_mobile, owner_mobile, parent_id, owner_id, source,
          tin, location, national_id, woreda, sub_city, house_no, trade_name, photo_keywords,
          first_seen_period, last_seen_period, created_by, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        mobile, userName, category.id, normalizeStatus(b.status), b.geo_domain_raw || null,
        b.product || 'eTopUP', b.business_type || null, parentMobile, ownerMobile, parentId, ownerId,
        tin, location, nationalId, woreda, subCity, houseNo, tradeName, photoKeywords,
        period, period, req.user?.username || req.user?.email || 'system', b.notes || null,
      ]
    );

    // Hand-registered rows get their identifier code immediately, so the list
    // shows one the moment the form closes.
    await assignIdentifierCodes();

    invalidate('/channel');
    res.status(201).json({ message: 'Channel user registered', id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── PUT /api/channel/entities/:id/stock-balance ────────────────────────────
/**
 * Set a channel user's current stock balance.
 *
 * The level reports let an operator correct what a Sub-Distributor or Retailer
 * holds without re-importing a whole workbook. The figure lands on the entity's
 * **current stock**: the row it already has for its most recent period is
 * overwritten, and a user with no balance at all gets one for the current month.
 * That is the row every report reads by default, so the change shows up
 * immediately in the summary, the charts and the list.
 */
// Stock balance edit endpoint removed — balance is no longer imported or tracked.

// ── PUT /api/channel/entities/:id ──────────────────────────────────────────

router.put('/entities/:id', async (req, res) => {
  try {
    await ensureChannelSchema();
    const b = req.body || {};
    const [existing] = await pool.query('SELECT * FROM channel_entities WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Channel entity not found' });
    const current = existing[0];

    const category = b.category_code || b.category_id
      ? await resolveCategory(b.category_code || b.category_id)
      : { id: current.category_id };
    if (!category) return res.status(400).json({ error: 'A valid category is required' });

    const parentMobile = b.parent_mobile !== undefined ? normalizeMobileForStore(b.parent_mobile) : current.parent_mobile;
    const ownerMobile = b.owner_mobile !== undefined ? normalizeMobileForStore(b.owner_mobile) : current.owner_mobile;
    const { parentId, ownerId } = await resolveLinks(parentMobile, ownerMobile, current.id);

    await pool.query(
      `UPDATE channel_entities
          SET user_name = ?, category_id = ?, status = ?, geo_domain_raw = ?, product = ?,
              business_type = ?, parent_mobile = ?, owner_mobile = ?, parent_id = ?, owner_id = ?,
              tin = ?, location = ?, national_id = ?,
              woreda = ?, sub_city = ?, house_no = ?, trade_name = ?, photo_keywords = ?,
              notes = ?,
              source = IF(source = 'manual', 'manual', source)
        WHERE id = ?`,
      [
        b.user_name !== undefined ? String(b.user_name).trim().replace(/\s+/g, ' ') : current.user_name,
        category.id,
        b.status !== undefined ? normalizeStatus(b.status) : current.status,
        b.geo_domain_raw !== undefined ? b.geo_domain_raw : current.geo_domain_raw,
        b.product !== undefined ? b.product : current.product,
        b.business_type !== undefined ? b.business_type || null : current.business_type,
        parentMobile, ownerMobile, parentId, ownerId,
        b.tin !== undefined ? text(b.tin, 50) : current.tin,
        b.location !== undefined ? text(b.location, 255) : current.location,
        b.national_id !== undefined ? text(b.national_id, 50) : current.national_id,
        b.woreda !== undefined ? text(b.woreda, 150) : current.woreda,
        b.sub_city !== undefined ? text(b.sub_city, 150) : current.sub_city,
        b.house_no !== undefined ? text(b.house_no, 100) : current.house_no,
        b.trade_name !== undefined ? text(b.trade_name, 255) : current.trade_name,
        b.photo_keywords !== undefined ? text(b.photo_keywords, 255) : current.photo_keywords,
        b.notes !== undefined ? b.notes : current.notes,
        req.params.id,
      ]
    );

    let balanceWritten = false;
    if (b.available_balance !== undefined && b.available_balance !== '' && b.available_balance !== null) {
      const period = normalizePeriod(b.period_month)
        || (await pool.query('SELECT MAX(period_month) p FROM channel_stock_balances WHERE entity_id = ?', [req.params.id]))[0][0]?.p
        || new Date().toISOString().slice(0, 8) + '01';
      const balance = Number(String(b.available_balance).replace(/[,\s]/g, ''));
      if (Number.isFinite(balance)) {
        await pool.query(
          `INSERT INTO channel_stock_balances (entity_id, period_month, product, available_balance, source)
           VALUES (?,?,?,?, 'manual')
           ON DUPLICATE KEY UPDATE available_balance = VALUES(available_balance), source = 'manual', updated_at = NOW()`,
          [req.params.id, period, (b.product || current.product || 'eTopUP').slice(0, 150), balance]
        );
        balanceWritten = true;
      }
    }

    invalidate('/channel');
    res.json({ message: 'Channel entity updated', id: Number(req.params.id), balance_written: balanceWritten });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── DELETE /api/channel/entities/:id ───────────────────────────────────────

router.delete('/entities/:id', async (req, res) => {
  try {
    await ensureChannelSchema();
    const [rows] = await pool.query('SELECT * FROM channel_entities WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Channel entity not found' });

    const [children] = await pool.query(
      'SELECT COUNT(*) AS c FROM channel_entities WHERE parent_id = ? OR owner_id = ?',
      [req.params.id, req.params.id]
    );
    if (Number(children[0].c) > 0 && req.query.force !== '1') {
      return res.status(409).json({
        error: `This entity has ${children[0].c} downstream channel user(s). Reassign or delete them first, or pass force=1.`,
        downstream: Number(children[0].c),
      });
    }

    await pool.query('DELETE FROM channel_stock_balances WHERE entity_id = ?', [req.params.id]);
    await pool.query('DELETE FROM channel_entities WHERE id = ?', [req.params.id]);
    invalidate('/channel');
    res.json({ message: 'Channel entity deleted', id: Number(req.params.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeMobileForStore(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(/\.0+$/, '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (s.startsWith('251') && s.length >= 12) s = s.slice(-9);
  else if (s.startsWith('0') && s.length === 10) s = s.slice(1);
  return /^\d{9,15}$/.test(s) ? s : null;
}

function normalizeStatus(v) {
  const s = String(v || '').toLowerCase();
  if (s.startsWith('cancel')) return 'canceled';
  if (s.startsWith('inactive')) return 'inactive';
  return 'active';
}

async function resolveCategory(value) {
  if (!value) return null;
  const sql = `SELECT c.id, c.code, c.name, c.level, d.code AS domain_code
                 FROM channel_categories c JOIN channel_domains d ON d.id = c.domain_id
                WHERE c.$COL = ?`;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const [rows] = await pool.query(sql.replace('$COL', 'id'), [Number(value)]);
    return rows[0] || null;
  }
  const [rows] = await pool.query(sql.replace('$COL', 'code'), [String(value)]);
  return rows[0] || null;
}

/** Resolve parent/owner ids, defaulting the owner to the parent for direct children. */
async function resolveLinks(parentMobile, ownerMobile, selfId = null) {
  let parentId = null;
  let ownerId = null;
  let parentRow = null;

  if (parentMobile) {
    const [rows] = await pool.query('SELECT id, owner_id FROM channel_entities WHERE mobile_number = ?', [parentMobile]);
    if (rows.length) { parentId = rows[0].id; parentRow = rows[0]; }
  }
  if (ownerMobile) {
    const [rows] = await pool.query('SELECT id FROM channel_entities WHERE mobile_number = ?', [ownerMobile]);
    if (rows.length) ownerId = rows[0].id;
  }
  if (!ownerId && parentRow) ownerId = parentRow.owner_id || parentId;

  if (selfId && (parentId === Number(selfId) || ownerId === Number(selfId))) {
    throw new Error('An entity cannot be its own parent or owner');
  }
  return { parentId, ownerId };
}

module.exports = router;
