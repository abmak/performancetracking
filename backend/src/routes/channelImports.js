/**
 * Indirect Channel — batch import.
 *
 * Two-step flow so a server restart can never strand a half-finished import:
 *   1. POST /preview  — parse the workbook, validate every row, report what
 *                       would change, and stage the accepted rows (plus the
 *                       rejects) against the batch. Writes nothing to the
 *                       entity / balance tables.
 *   2. POST /confirm  — commit the batch's staged rows idempotently on
 *                       (mobile, period, product).
 *
 * Rows the validator flagged (missing upline, zero balance, …) are staged like
 * any other row, but /confirm only writes them when the caller passes
 * `include_warnings: true`. Sending `false` discards them and records how many
 * the batch dropped, so the choice is visible in the import history.
 *
 * The channel is a snapshot dataset: the workbook carries no date, so the
 * caller supplies the "as of" period.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');

const pool = require('../config/database');
const { invalidate } = require('../utils/endpointCache');
const { relinkHierarchy } = require('./channelHierarchy');
const { isMasterAdmin } = require('../middleware/permissions');
const {
  ensureChannelSchema,
  assignIdentifierCodes,
  SUMMARY_LEVEL_MAP,
  SUMMARY_DOMAIN_MAP,
  SUMMARY_CATEGORY_LEVELS,
} = require('../config/channelDbSetup');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls or .csv files are accepted'), ok);
  },
});

/**
 * IMP-YYYYMMDD-NN — the short, unique, quotable id for one import run.
 *
 * The batch uuid stays the key the database works with; this is the id an
 * operator reads off the screen, writes on a ticket and asks about later. The
 * sequence is per day, and the unique index on the column is the real guard: if
 * two imports race for the same number the insert is retried with the next one.
 */
async function nextImportCode() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const [rows] = await pool.query(
    'SELECT import_code FROM channel_import_batches WHERE import_code LIKE ? ORDER BY import_code DESC LIMIT 1',
    [`IMP-${stamp}-%`]
  );
  const last = rows[0]?.import_code ? Number(String(rows[0].import_code).split('-').pop()) || 0 : 0;
  return `IMP-${stamp}-${String(last + 1).padStart(2, '0')}`;
}

const MAX_STORED_ERRORS = 2000;
const CHUNK = 500;
// The preview screen only ever renders the first hundred rows of each list, so
// there is no reason to ship a 50k-row workbook back to the browser.
const PREVIEW_ROW_LIMIT = 500;

// ── Value normalisation ────────────────────────────────────────────────────

const key = (v) =>
  String(v === null || v === undefined ? '' : v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const clean = (v) =>
  v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' ');

/** Mobile numbers arrive as 9-digit local numbers, but tolerate +251 / 0 prefixes. */
function normalizeMobile(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(/\.0+$/, '').replace(/[^\d+]/g, '');
  s = s.replace(/^\+/, '');
  if (s.startsWith('251') && s.length >= 12) s = s.slice(-9);
  else if (s.startsWith('0') && s.length === 10) s = s.slice(1);
  if (!/^\d{9,15}$/.test(s)) return null;
  return s;
}

function parseAmount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return { value: v, numeric: true };
  if (v === null || v === undefined || v === '') return { value: 0, numeric: true };
  const cleaned = String(v).replace(/[,\s]/g, '');
  const n = Number(cleaned);
  if (Number.isFinite(n)) return { value: n, numeric: true };
  return { value: 0, numeric: false };
}

function normalizeStatus(v) {
  const s = clean(v).toLowerCase();
  if (s.startsWith('cancel')) return 'canceled';
  if (s.startsWith('inactive')) return 'inactive';
  return 'active';
}

// Sheet-name fallback, used only when the Category column is absent.
const SHEET_HINTS = {
  idcd: 'IC_DISTRIBUTOR',
  idcdistributor: 'IC_DISTRIBUTOR',
  subdist: null, // this sheet mixes IC- and AC- rows, so the column must decide
  subdistributor: null,
  idcretalier: 'IC_RETAILER',
  idcretailer: 'IC_RETAILER',
  bankandthirdparty: 'ENTERPRISE_L1',
  yimuonlydist: 'YIMULU_DISTRIBUTOR',
  yimuonlysub: 'YIMULU_SUB_DISTRIBUTOR',
  yimulonlyretalier: 'YIMULU_RETAILER',
  yimulonlyretailer: 'YIMULU_RETAILER',
};

// The “generic” contract: one flat sheet with a Category column, shared by
// every domain. Still accepted, including for old files.
const COLUMN_ALIASES = {
  username: ['username', 'name', 'fullname', 'channeluser'],
  mobile: ['mobilenumber', 'mobile', 'mobileno', 'msisdn', 'phonenumber'],
  category: ['category', 'usercategory'],
  status: ['userstatus', 'status'],
  geo: ['geographicaldomain', 'geographicdomain', 'region', 'geo'],
  product: ['product', 'products'],
  balance: ['availablebalance', 'stockbalance', 'balance', 'availableamount'],
  parentName: ['parentname'],
  parentMobile: ['parentmobile', 'parentmobileno', 'parentmobilenumber'],
  ownerName: ['owneruser', 'ownername', 'owner'],
  ownerMobile: ['ownermobile', 'ownermobileno', 'ownermobilenumber'],
  businessType: ['business', 'businesstype', 'existingbusiness'],
};

/** IDC level → canonical category code. */
const LEVEL_CATEGORY = {
  1: 'IC_DISTRIBUTOR',
  2: 'IC_SUB_DISTRIBUTOR',
  3: 'IC_RETAILER',
};

/** Platform default when a sheet names no air-time type. */
const DEFAULT_PRODUCT = 'eTopUP';

/**
 * The IDC hierarchy workbook.
 *
 * Each level has its own column layout and the **layout itself identifies the
 * level** — there is no Category column. A retailer row names its
 * Sub-Distributor and Distributor inline, together with their contact numbers
 * and the Distributor's region, so a single retailer sheet describes the whole
 * chain.
 *
 * Aliases are listed as normalised header keys (see `key()`), because the
 * source files spell these columns inconsistently in practice:
 * "Retalier exsting business", "Sub distributer contact", "Distributer
 * Region", "Distributor Contac".
 */
const LEVEL_LAYOUTS = [
  {
    kind: 'retailer',
    level: 3,
    category_code: 'IC_RETAILER',
    signature: ['retailername'],
    username: ['retailername'],
    mobile: ['retailermobilenumber', 'retailermobile', 'retailermobileno', 'retailercontact', 'retailerphonenumber'],
    status: ['retailerstatus', 'retaileruserstatus'],
    geo: ['retailergeographicaldomain', 'retailergeographicdomain', 'retailerregion', 'retailergeo'],
    businessType: ['retalierexstingbusiness', 'retalierexistingbusiness', 'retalierbusiness', 'retailerbusiness', 'retailerexistingbusiness'],
    parentName: ['subdistributorname', 'subdistributername'],
    parentMobile: ['subdistributorcontact', 'subdistributercontact', 'subdistributornumber', 'subdistributermobilenumber', 'subdistributormobile', 'subdistributermobile'],
    ownerName: ['distributorname', 'distributername'],
    ownerMobile: ['distributorcontact', 'distributorcontac', 'distributercontact', 'distributercontac', 'distributormobilenumber', 'distributormobile', 'distributermobile'],
    ownerRegion: ['distributorregion', 'distributerregion'],
    product: ['airtimetype', 'airtimetypecode', 'airtime'],
    balance: ['availablebalance', 'stockbalance', 'balance', 'availableamount'],
    // Optional retailer-only compliance details.
    tin: ['retailertin', 'retailertinno', 'retailertinnumber', 'retailertinoptional', 'tin', 'tinno', 'tinnumber', 'taxidentificationnumber'],
    location: ['retailerlocation', 'retaileraddress', 'retailersite', 'location', 'address', 'site'],
    nationalId: ['retailernationalfaydaid', 'retailernationalid', 'retailerfaydaid', 'retailerfaydanumber', 'nationalfaydaid', 'nationalid', 'faydaid', 'faydanumber'],
  },
  {
    kind: 'sub_distributor',
    level: 2,
    category_code: 'IC_SUB_DISTRIBUTOR',
    signature: ['subdistributorname', 'subdistributername'],
    username: ['subdistributorname', 'subdistributername'],
    mobile: ['subdistributormobilenumber', 'subdistributormobile', 'subdistributermobile', 'subdistributorcontact', 'mobilenumber', 'mobile'],
    status: ['subdistributorstatus', 'status', 'userstatus'],
    // Geographical Domain removed from the Sub-Distributor sheet: a
    // Sub-Distributor has no territory of its own in the IDC model — the area
    // the retailers under it trade in is already on each Retailer row.
    geo: [],
    // Existing Business removed from the Sub-Distributor sheet.
    businessType: [],
    parentName: ['distributorname', 'distributername'],
    parentMobile: ['distributorcontact', 'distributorcontac', 'distributercontact', 'distributormobile', 'distributermobile'],
    ownerName: ['distributorname', 'distributername'],
    ownerMobile: ['distributorcontact', 'distributorcontac', 'distributercontact', 'distributormobile', 'distributermobile'],
    ownerRegion: ['distributorregion', 'distributerregion'],
    product: ['airtimetype', 'airtimetypecode', 'airtime', 'product'],
    balance: ['availablebalance', 'stockbalance', 'balance', 'availableamount'],
  },
  {
    kind: 'distributor',
    level: 1,
    category_code: 'IC_DISTRIBUTOR',
    signature: ['distributorname', 'distributername'],
    username: ['distributorname', 'distributername'],
    mobile: ['distributormobilenumber', 'distributormobile', 'distributermobile', 'distributorcontact', 'mobilenumber', 'mobile'],
    status: ['distributorstatus', 'status', 'userstatus'],
    geo: ['distributorregion', 'distributerregion', 'geographicaldomain', 'region', 'geo'],
    // Existing Business removed from the Distributor sheet.
    businessType: [],
    parentName: [],
    parentMobile: [],
    ownerName: [],
    ownerMobile: [],
    ownerRegion: [],
    product: ['airtimetype', 'airtimetypecode', 'airtime', 'product'],
    balance: ['availablebalance', 'stockbalance', 'balance', 'availableamount'],
  },
];

const LAYOUT_FIELDS = [
  'username', 'mobile', 'status', 'geo', 'businessType', 'parentName', 'parentMobile',
  'ownerName', 'ownerMobile', 'ownerRegion', 'product', 'balance',
  // Only the retailer layout declares these, so a Distributor or
  // Sub-Distributor sheet simply never maps them.
  'tin', 'location', 'nationalId',
];

/** The level layout a header row belongs to, or null for the generic contract. */
function matchLevelLayout(byKey) {
  for (const layout of LEVEL_LAYOUTS) {
    if (layout.signature.some((k) => byKey[k] !== undefined)) return layout;
  }
  return null;
}

function pickIndex(byKey, names) {
  for (const n of names || []) if (byKey[n] !== undefined) return byKey[n];
  return undefined;
}

/**
 * Fuzzy-find a TIN column the alias list missed: split each header into words
 * and accept one that names a TIN ("Retailer TIN", "Tax ID No.", "tin_number")
 * — word boundaries keep ordinary words like "Sorting" or "Testing" from
 * matching a naive substring check.
 */
function fuzzyTinIndex(headerRow) {
  return (headerRow || []).findIndex((h) => {
    const words = String(h || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words.some((w) =>
      w === 'tin' || w.startsWith('tin') || w === 'tax'
      || w.startsWith('taxid') || w.startsWith('taxidentification'));
  });
}

function buildColumnMap(headerRow) {
  const byKey = {};
  (headerRow || []).forEach((h, i) => {
    const k = key(h);
    if (k && byKey[k] === undefined) byKey[k] = i;
  });

  // A level sheet is identified by its own headers, so it needs no Category
  // column and no sheet-name hint.
  const layout = matchLevelLayout(byKey);
  if (layout) {
    const map = { layout };
    for (const field of LAYOUT_FIELDS) {
      const idx = pickIndex(byKey, layout[field]);
      if (idx !== undefined) map[field] = idx;
    }
    // Fallback: a TIN column the alias list doesn't recognise. After the
    // named aliases miss, accept a word-boundary TIN/Tax header — so a file
    // headed "Tax ID No." or "TIN of Retailer" still imports its TINs
    // instead of silently dropping them.
    if (map.tin === undefined) {
      const fuzzy = fuzzyTinIndex(headerRow);
      if (fuzzy !== -1) {
        map.tin = fuzzy;
        map.tinFuzzy = true;
      }
    }
    return { map, byKey, layout };
  }

  // Generic contract: one flat sheet carrying an explicit Category column.
  const map = {};
  for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
    const idx = pickIndex(byKey, names);
    if (idx !== undefined) map[field] = idx;
  }
  if (map.tin === undefined) {
    const fuzzy = fuzzyTinIndex(headerRow);
    if (fuzzy !== -1) {
      map.tin = fuzzy;
      map.tinFuzzy = true;
    }
  }
  return { map, byKey, layout: null };
}

function isSummarySheet(byKey) {
  return byKey.domain !== undefined && byKey.category !== undefined && byKey.stockbalance !== undefined;
}

/**
 * Locate the header row. Not every sheet puts it on row 1 — the summary block
 * carries a title row above its header — so scan the top of the sheet for a
 * signature we recognise: either the summary columns, or a mobile column
 * alongside a user-name column.
 */
function findHeaderRow(matrix) {
  const scanLimit = Math.min(matrix.length, 15);
  for (let i = 0; i < scanLimit; i++) {
    if (!matrix[i]) continue;
    const { map, byKey, layout } = buildColumnMap(matrix[i]);
    if (isSummarySheet(byKey)) return { map, byKey, layout: null, headerIndex: i };
    if (map.mobile !== undefined && map.username !== undefined) {
      return { map, byKey, layout, headerIndex: i };
    }
  }
  return null;
}

// ── Lookups ────────────────────────────────────────────────────────────────

async function loadLookups() {
  const [domains] = await pool.query('SELECT id, code, name FROM channel_domains');
  const [cats] = await pool.query(
    'SELECT c.id, c.code, c.name, c.level, c.domain_id, d.code AS domain_code FROM channel_categories c JOIN channel_domains d ON d.id = c.domain_id'
  );
  const [aliases] = await pool.query('SELECT raw_value, category_id FROM channel_category_aliases');

  const catByCode = Object.fromEntries(cats.map((c) => [c.code, c]));
  const domainByCode = Object.fromEntries(domains.map((d) => [d.code, d]));
  const aliasMap = {};
  for (const a of aliases) aliasMap[key(a.raw_value)] = a.category_id;
  // Also accept the canonical codes/names directly.
  for (const c of cats) {
    aliasMap[key(c.code)] = c.id;
    aliasMap[key(c.name)] = c.id;
  }
  return { domains, cats, catByCode, domainByCode, aliasMap };
}

// ── Workbook parsing ───────────────────────────────────────────────────────

function parseWorkbook(buffer, lookups) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const rows = [];
  const errors = [];
  const sheets = [];
  const summaryRows = [];
  let rowCounter = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
    if (!matrix.length) continue;

    const header = findHeaderRow(matrix);
    if (!header) {
      sheets.push({ name: sheetName, kind: 'skipped', rows: 0, reason: 'No recognisable header row found' });
      continue;
    }
    const { map, byKey, layout, headerIndex } = header;

    // ── Summary block: Domain | Category | Stock Balance ──
    if (isSummarySheet(byKey)) {
      let currentDomain = null;
      let parsed = 0;
      for (let i = headerIndex + 1; i < matrix.length; i++) {
        const r = matrix[i];
        if (!r) continue;
        const rawDomain = clean(r[byKey.domain]);
        if (rawDomain) currentDomain = rawDomain;
        const rawCat = clean(r[byKey.category]);
        const amount = parseAmount(r[byKey.stockbalance]);
        if (!currentDomain || !rawCat) continue;

        // The domain is only printed on the first row of each group, so the
        // lookup must use the forward-filled value.
        const domainCode = SUMMARY_DOMAIN_MAP[String(currentDomain).toUpperCase()] || null;
        const level = SUMMARY_CATEGORY_LEVELS[rawCat.toUpperCase()] || null;
        const catCode = domainCode && level ? (SUMMARY_LEVEL_MAP[domainCode] || {})[level] : null;

        if (!domainCode) {
          errors.push({
            sheet_name: sheetName, row_num: i + 1, severity: 'warning',
            scope: 'summary',
            reason: `Unrecognised summary domain "${currentDomain}"`, raw_data: r,
          });
          continue;
        }
        if (!level) {
          errors.push({
            sheet_name: sheetName, row_num: i + 1, severity: 'warning',
            scope: 'summary',
            reason: `Unrecognised summary category "${rawCat}" — stored without a level mapping`, raw_data: r,
          });
        }

        summaryRows.push({
          domain_code: domainCode,
          category_code: catCode || null,
          category_label: rawCat,
          level,
          stock_balance: amount.value,
        });
        parsed++;
      }
      if (parsed) sheets.push({ name: sheetName, kind: 'summary', rows: parsed });
      continue;
    }

    // ── Detail sheet ──
    const nameIdx = map.username;
    // A level sheet states its own level, so it needs no sheet-name hint.
    const sheetLevel = layout ? layout.level : null;
    const sheetHint = SHEET_HINTS[key(sheetName)] || null;
    let accepted = 0;

    for (let i = headerIndex + 1; i < matrix.length; i++) {
      const r = matrix[i];
      if (!r) continue;
      rowCounter++;

      const rawName = clean(r[nameIdx]);
      const rawMobile = map.mobile !== undefined ? r[map.mobile] : null;
      const mobile = normalizeMobile(rawMobile);
      const rawCategory = map.category !== undefined ? clean(r[map.category]) : '';

      // Skip entirely blank trailing rows rather than rejecting them.
      if (!rawName && !rawMobile && !rawCategory) continue;

      const record = {
        sheet: sheetName,
        row: i + 1,
        name: rawName,
        mobile,
        category_code: null,
        category_id: null,
        status: map.status !== undefined ? normalizeStatus(r[map.status]) : 'active',
        geo: map.geo !== undefined ? clean(r[map.geo]) || null : null,
        business_type: map.businessType !== undefined ? clean(r[map.businessType]) || null : null,
        product: (map.product !== undefined ? clean(r[map.product]) : '') || DEFAULT_PRODUCT,
        level: sheetLevel,
        parent_name: map.parentName !== undefined ? clean(r[map.parentName]) || null : null,
        parent_mobile: map.parentMobile !== undefined ? normalizeMobile(r[map.parentMobile]) : null,
        owner_name: map.ownerName !== undefined ? clean(r[map.ownerName]) || null : null,
        owner_mobile: map.ownerMobile !== undefined ? normalizeMobile(r[map.ownerMobile]) : null,
        owner_region: map.ownerRegion !== undefined ? clean(r[map.ownerRegion]) || null : null,
        tin: map.tin !== undefined ? clean(r[map.tin]) || null : null,
        location: map.location !== undefined ? clean(r[map.location]) || null : null,
        national_id: map.nationalId !== undefined ? clean(r[map.nationalId]) || null : null,
        balance: map.balance !== undefined ? parseAmount(r[map.balance]) : { value: 0, numeric: true },
      };

      // Category: a level sheet names it in its own layout; otherwise the
      // Category column wins and the sheet name is only a fallback.
      let catId = null;
      let catCode = null;
      if (layout) {
        catId = lookups.catByCode[layout.category_code]?.id || null;
        catCode = catId ? layout.category_code : null;
      } else {
        if (rawCategory) catId = lookups.aliasMap[key(rawCategory)] || null;
        if (catId) catCode = Object.values(lookups.catByCode).find((c) => c.id === catId)?.code || null;
        if (!catId && sheetHint) { catId = lookups.catByCode[sheetHint]?.id || null; catCode = catId ? sheetHint : null; }
      }

      const reject = (reason) => {
        errors.push({
          sheet_name: sheetName, row_num: i + 1, severity: 'reject',
          reason, raw_data: { name: rawName, mobile: rawMobile, category: rawCategory },
        });
      };

      if (!mobile) { reject('Missing or invalid mobile number'); continue; }
      if (!rawName) { reject('Missing user name'); continue; }
      if (!catId) { reject(`Unmapped category "${rawCategory || '(blank)'}"`); continue; }

      // Warnings — optional data that is missing or unusual but the row
      // is still processed. The row is flagged so /confirm can offer the
      // operator the choice of importing or discarding it.
      let warned = false;
      const warn = (reason) => {
        warned = true;
        errors.push({
          sheet_name: sheetName, row_num: i + 1, severity: 'warning',
          scope: 'row',
          reason, raw_data: { name: rawName, mobile: rawMobile },
        });
      };
      // A Distributor sits at the top of the chain, so a missing upline is
      // expected there rather than flagged. A Sub-Distributor carries no
      // territory of its own, so its missing geographical domain is expected
      // too — the areas its retailers trade in live on the Retailer rows.
      const expectsUpline = sheetLevel === null || sheetLevel > 1;
      if (!record.geo && (sheetLevel === null || sheetLevel > 2)) warn('Missing geographical domain');
      if (expectsUpline && !record.parent_mobile) warn('Missing parent (upline) mobile');
      if (expectsUpline && !record.owner_mobile) warn('Missing owner (distributor) mobile');

      record.category_id = catId;
      record.category_code = catCode;
      record.balance = record.balance.value;
      record.has_warning = warned;
      rows.push(record);
      accepted++;
    }

    sheets.push({
      name: sheetName,
      kind: 'detail',
      layout: layout ? layout.kind : null,
      level: sheetLevel,
      rows: accepted,
      category_hint: sheetHint,
      categories: [...new Set(matrix.slice(headerIndex + 1).filter(Boolean).map((r) => (map.category !== undefined ? clean(r[map.category]) : '')).filter(Boolean))],
    });
  }

  return { rows, errors, sheets, summaryRows, totalRows: rowCounter };
}

/** One row per mobile: keep the highest absolute balance, log the rest. */
function dedupeByMobile(rows, errors) {
  const best = new Map();
  const duplicates = [];
  for (const r of rows) {
    const prev = best.get(r.mobile);
    if (!prev) { best.set(r.mobile, r); continue; }
    const keepNew = Math.abs(r.balance) > Math.abs(prev.balance);
    const kept = keepNew ? r : prev;
    const dropped = keepNew ? prev : r;
    best.set(r.mobile, kept);
    duplicates.push(dropped);
    errors.push({
      sheet_name: dropped.sheet, row_num: dropped.row, severity: 'duplicate',
      reason: `Duplicate mobile ${r.mobile} in this file — kept the higher balance (${kept.balance})`,
      raw_data: { name: dropped.name, mobile: dropped.mobile, balance: dropped.balance },
    });
  }
  return { unique: [...best.values()], duplicates };
}

// ── GET /api/channel/imports/template ─────────────────────────────────────
// Downloads a workbook pre-filled with the expected columns so the workbook
// can be filled in and re-uploaded through the preview/confirm flow.

/**
 * buildTemplateWorkbook — the downloadable import template.
 *
 * Mirrors the source retailer workbook column-for-column on a sheet named after
 * it, so the file a user downloads can be filled in and fed straight back
 * through the preview/confirm flow without renaming anything. Exported so the
 * template can be round-tripped through parseWorkbook in tests.
 */
function buildTemplateWorkbook(cats = []) {
  {
    const wb = XLSX.utils.book_new();

    // ── The three IDC level sheets ────────────────────────────────────────
    // Each level has its own column layout and the layout identifies the level,
    // so no Category column is needed. A sheet names its uplines inline, and a
    // retailer row carries its Sub-Distributor's and Distributor's contact and
    // region — one retailer file is enough to describe the whole chain.

    const addSheet = (name, header, rows) => {
      const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
      sheet['!cols'] = header.map((h) => ({ wch: Math.max(h.length + 3, 15) }));
      XLSX.utils.book_append_sheet(wb, sheet, name);
    };

    addSheet(
      'Distributor',
      ['Distributor Name', 'Distributor Mobile Number', 'Distributor Status',
        'Distributor Region', 'Air Time Type'],
      [
        ['Ebyan Communication', '985693664', 'Active', 'EER', 'EVD'],
        ['Bisrat Melaku General Trading', '911674451', 'Active', 'SR', 'EVD'],
        ['Bereket Tsegaye', '919999575', 'Active', 'SSWR', 'EVD'],
      ]
    );

    addSheet(
      'Sub-Distributor',
      ['Sub Distributor Name', 'Sub Distributor Mobile Number', 'Sub Distributor Status',
        'Distributor Name', 'Distributor Region', 'Distributor Contact',
        'Air Time Type'],
      [
        ['Nuuro Ahmed Mohamed', '978649795', 'Active', 'Ebyan Communication', 'EER', '985693664', 'EVD'],
        ['Rediet Yoseph', '911851164', 'Active', 'Bisrat Melaku General Trading', 'SR', '911674451', 'EVD'],
      ]
    );

    addSheet(
      'Retailer',
      ['Retailer Name', 'Retailer Existing Business', 'Retailer Mobile Number', 'Retailer Status',
        'Retailer Geographical Domain', 'Sub Distributor Name', 'Sub Distributor Contact',
        'Distributor Name', 'Distributor Region', 'Distributor Contact',
        'Retailer TIN', 'Retailer Location', 'Retailer National/Fayda ID',
        'Air Time Type'],
      [
        ['Hoodo geele Abane', 'super market', '978858396', 'Active', 'Hargele', 'Nuuro Ahmed Mohamed', '978649795', 'Ebyan Communication', 'EER', '985693664', '0041234567', 'Hargele, Kebele 03, near the bus station', '39012345678901', 'EVD'],
        ['ABDIKARIM ALI ADOWA', 'Shopes', '946653596', 'Active', 'Hargele', 'Nuuro Ahmed Mohamed', '978649795', 'Ebyan Communication', 'EER', '985693664', '', 'Hargele, Kebele 01', '39012345678902', 'EVD'],
        ['gas awale faysal', 'Open Market', '953385387', 'Active', 'Kebribeyah', 'buro Muhumed Bare', '953494396', 'Ebyan Communication', 'EER', '985693664', '', '', '39012345678903', 'EVD'],
        ['biruk lema', 'super market', '916035340', 'Active', 'Hawassa', 'Rediet Yoseph', '911851164', 'Bisrat Melaku General Trading', 'SR', '911674451', '', 'Hawassa, Tabor sub-city', '', 'EVD'],
      ]
    );

    // ── Optional summary block (Domain | Category) ──
    const summaryHeader = ['Domain', 'Category'];
    const summaryRows = [
      ['IDC', 'Distributor'],
      ['IDC', 'Sub Distributor'],
      ['IDC', 'Retailer'],
      ['Yimulu Only', 'Distributor'],
      ['Yimulu Only', 'Sub Distributor'],
      ['Yimulu Only', 'Retailer'],
      ['Enterprise', 'Bank, Fintech & International'],
      ['Enterprise', 'Agent Sub Distributor'],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
    summarySheet['!cols'] = summaryHeader.map((h) => ({ wch: Math.max(h.length + 3, 16) }));
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // No Reference sheet — the example rows on each level sheet already show
    // the format, and the upload page documents the column contract.
    return wb;
  }
}

/**
 * Build a single-level template workbook. The operator picks one level and
 * gets a file that contains only that level's sheet — so the person filling
 * it in is not confused by columns they will never use.
 */
function buildSingleLevelTemplate(level, cats = []) {
  const wb = XLSX.utils.book_new();
  const addSheet = (name, header, rows) => {
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet['!cols'] = header.map((h) => ({ wch: Math.max(h.length + 3, 15) }));
    XLSX.utils.book_append_sheet(wb, sheet, name);
  };

  if (level === 1) {
    addSheet(
      'Distributor',
      ['Distributor Name', 'Distributor Mobile Number', 'Distributor Status',
        'Distributor Region', 'Air Time Type'],
      [
        ['Ebyan Communication', '985693664', 'Active', 'EER', 'EVD'],
        ['Bisrat Melaku General Trading', '911674451', 'Active', 'SR', 'EVD'],
      ]
    );
  } else if (level === 2) {
    addSheet(
      'Sub-Distributor',
      ['Sub Distributor Name', 'Sub Distributor Mobile Number', 'Sub Distributor Status',
        'Distributor Name', 'Distributor Region', 'Distributor Contact',
        'Air Time Type'],
      [
        ['Nuuro Ahmed Mohamed', '978649795', 'Active', 'Ebyan Communication', 'EER', '985693664', 'EVD'],
        ['Rediet Yoseph', '911851164', 'Active', 'Bisrat Melaku General Trading', 'SR', '911674451', 'EVD'],
      ]
    );
  } else if (level === 3) {
    addSheet(
      'Retailer',
      ['Retailer Name', 'Retailer Existing Business', 'Retailer Mobile Number', 'Retailer Status',
        'Retailer Geographical Domain', 'Sub Distributor Name', 'Sub Distributor Contact',
        'Distributor Name', 'Distributor Region', 'Distributor Contact',
        'Retailer TIN', 'Retailer Location', 'Retailer National/Fayda ID',
        'Air Time Type'],
      [
        ['Hoodo geele Abane', 'super market', '978858396', 'Active', 'Hargele', 'Nuuro Ahmed Mohamed', '978649795', 'Ebyan Communication', 'EER', '985693664', '0041234567', 'Hargele, Kebele 03, near the bus station', '39012345678901', 'EVD'],
        ['ABDIKARIM ALI ADOWA', 'Shopes', '946653596', 'Active', 'Hargele', 'Nuuro Ahmed Mohamed', '978649795', 'Ebyan Communication', 'EER', '985693664', '', 'Hargele, Kebele 01', '39012345678902', 'EVD'],
      ]
    );
  }

  // No Reference sheet — the example rows already show the format.
  return wb;
}

router.get('/template', async (req, res) => {
  try {
    const { cats } = await loadLookups();
    const level = parseInt(req.query.level, 10);
    const wb = level >= 1 && level <= 3
      ? buildSingleLevelTemplate(level, cats)
      : buildTemplateWorkbook(cats);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = level >= 1 && level <= 3
      ? `channel_import_${{ 1: 'distributor', 2: 'sub_distributor', 3: 'retailer' }[level]}.xlsx`
      : 'channel_import_template.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/channel/imports/preview ──────────────────────────────────────

router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // The workbook carries no date column, so uploads are stamped with the
    // current month automatically. An explicit period_month still wins if a
    // caller (or an older client) sends one.
    const period = normalizePeriod(req.body.period_month) || currentMonthPeriod();

    await ensureChannelSchema();
    const lookups = await loadLookups();

    const { rows, errors, sheets, summaryRows, totalRows } = parseWorkbook(req.file.buffer, lookups);

    // ── Expected-level guard ──────────────────────────────────────────────
    // When the operator picks a level before uploading, every detail sheet in
    // the workbook must have been parsed as that level. A mismatch is a reject
    // rather than a silent auto-detect, because the whole point of picking is
    // to get a guarantee that the columns were understood correctly.
    const expectedLevel = parseInt(req.body.expected_level, 10) || null;
    const levelLabel = { 1: 'Distributor', 2: 'Sub-Distributor', 3: 'Retailer' };
    if (expectedLevel >= 1 && expectedLevel <= 3) {
      const badSheets = (sheets || []).filter(
        (s) => s.kind === 'detail' && s.level && Number(s.level) !== expectedLevel
      );
      if (badSheets.length) {
        const detected = [...new Set(badSheets.map((s) => levelLabel[s.level] || `Level ${s.level}`))];
        errors.push({
          sheet_name: badSheets.map((s) => s.name).join(', '),
          row_num: null,
          severity: 'reject',
          reason: `The selected level was ${levelLabel[expectedLevel]}, but the columns in these sheet(s) were recognised as ${detected.join(', ')}. Check that you uploaded the right file, or pick the correct level.`,
          raw_data: { expected_level: expectedLevel, detected_levels: badSheets.map((s) => s.level) },
        });
      }
    }

    const detailTotal = rows.reduce((a, r) => a + r.balance, 0);
    const summaryTotal = summaryRows.reduce((a, r) => a + r.stock_balance, 0);

    const detailByCat = {};
    for (const r of rows) {
      detailByCat[r.category_code] = (detailByCat[r.category_code] || 0) + r.balance;
    }

    // Reconciliation: does this extract actually cover the summary totals?
    const reconciliation = summaryRows.map((s) => {
      const detail = s.category_code ? (detailByCat[s.category_code] || 0) : null;
      return {
        domain_code: s.domain_code,
        category_label: s.category_label,
        category_code: s.category_code,
        level: s.level,
        summary_total: round2(s.stock_balance),
        detail_total: detail === null ? null : round2(detail),
        variance: detail === null ? null : round2(s.stock_balance - detail),
        covers_summary: detail === null ? null : Math.abs(s.stock_balance - detail) < 1,
      };
    });

    const rejectCount = errors.filter((e) => e.severity === 'reject').length;
    // Warnings are counted per *row*, not per message: one row can be flagged
    // for several missing fields but is still a single import-or-discard call.
    const warningRows = rows.filter((r) => r.has_warning).length;
    const warningMessages = errors.filter((e) => e.severity === 'warning').length;
    // Balance held by the flagged rows, so the review screen can show the total
    // that will actually be written if they are discarded.
    const warningBalanceTotal = rows.filter((r) => r.has_warning).reduce((a, r) => a + r.balance, 0);

    const batchId = crypto.randomUUID();
    // Retry on the unique index rather than risk two imports sharing a code.
    let importCode = null;
    for (let attempt = 0; attempt < 5 && !importCode; attempt++) {
      const candidate = await nextImportCode();
      try {
        await pool.query(
          `INSERT INTO channel_import_batches
            (id, import_code, filename, period_month, total_rows, valid_rows, duplicate_rows, rejected_rows,
             warning_rows, detail_balance_total, summary_balance_total, summary_rows, reconciliation_variance, status, imported_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)`,
          [
            batchId, candidate, req.file.originalname, period, totalRows, rows.length, 0,
            rejectCount, warningRows, round2(detailTotal), round2(summaryTotal), summaryRows.length,
            round2(summaryTotal - detailTotal), req.user?.username || req.user?.email || 'system',
          ]
        );
        importCode = candidate;
      } catch (e) {
        // ER_DUP_ENTRY means another import took this number a moment ago; the
        // failed insert left no row behind, so simply take the next one.
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    if (!importCode) throw new Error('Could not allocate an import id');

    await storeErrors(batchId, errors);

    // Park the accepted rows against the batch so /confirm does not have to
    // receive them back from the browser.
    await stageRows(batchId, rows);

    // Periods already on file, so the review screen can warn about a reload.
    const [existing] = await pool.query(
      'SELECT COUNT(*) AS c FROM channel_stock_balances WHERE period_month = ?', [period]
    );

    // The rows the include/discard decision is about. They are returned
    // separately from the accepted-row page so a workbook whose warnings sit
    // past the first 500 rows still shows the operator what is at stake.
    const warnedRowsSample = rows.filter((r) => r.has_warning).slice(0, PREVIEW_ROW_LIMIT);

    res.json({
      batch: {
        id: batchId,
        import_code: importCode,
        filename: req.file.originalname,
        period_month: period,
        total_rows: totalRows,
        valid_rows: rows.length,
        clean_rows: rows.length - warningRows,
        duplicate_rows: 0,
        rejected_rows: rejectCount,
        warning_rows: warningRows,
        warning_messages: warningMessages,
        detail_balance_total: round2(detailTotal),
        warning_balance_total: round2(warningBalanceTotal),
        summary_balance_total: round2(summaryTotal),
        summary_rows: summaryRows.length,
        reconciliation_variance: round2(summaryTotal - detailTotal),
        existing_balances_for_period: existing[0].c,
        status: 'staged',
      },
      sheets,
      reconciliation,
      errors: errors.slice(0, 300),
      error_summary: summariseErrors(errors),
      rows: rows.slice(0, PREVIEW_ROW_LIMIT),
      rows_returned: Math.min(rows.length, PREVIEW_ROW_LIMIT),
      rows_truncated: rows.length > PREVIEW_ROW_LIMIT,
      warned_rows: warnedRowsSample,
      warned_rows_returned: warnedRowsSample.length,
      warned_rows_truncated: warningRows > warnedRowsSample.length,
      summary_rows: summaryRows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/channel/imports/confirm ─────────────────────────────────────

router.post('/confirm', async (req, res) => {
  try {
    const {
      batch_id: batchId,
      rows: clientRows,
      summary_rows: summaryRows = [],
      include_warnings: includeWarnings,
    } = req.body || {};
    if (!batchId) return res.status(400).json({ error: 'batch_id is required' });

    await ensureChannelSchema();

    // DATE_FORMAT the period: mysql2 hands DATE columns back as JS Dates, which
    // JSON-serialise in UTC and shift a 1st-of-month back a day.
    const [batches] = await pool.query(
      `SELECT b.*, DATE_FORMAT(b.period_month, '%Y-%m-%d') AS period_formatted
         FROM channel_import_batches b WHERE b.id = ?`,
      [batchId]
    );
    if (!batches.length) return res.status(404).json({ error: 'Import batch not found' });
    const batch = batches[0];
    if (batch.status === 'completed') {
      return res.status(400).json({ error: 'This batch has already been committed. Re-upload the file to apply a correction.' });
    }

    // Prefer the rows /preview staged against this batch. Older clients still
    // post them inline, so accept a body array as a fallback.
    const staged = await loadStagedRows(batchId);
    let rows = staged.length ? staged : (Array.isArray(clientRows) ? clientRows : []);
    if (!rows.length) {
      return res.status(400).json({ error: 'No staged rows for this batch — re-upload the workbook and preview it again.' });
    }

    // Rows the validator flagged are only written when the operator explicitly
    // approved including them. `include_warnings` is optional for older
    // callers, which keeps their long-standing behaviour (import everything).
    const warnedRows = rows.filter((r) => r.has_warning).length;
    let discarded = 0;
    const keepWarnings = includeWarnings !== false;
    if (!keepWarnings && warnedRows) {
      const kept = rows.filter((r) => !r.has_warning);
      if (!kept.length) {
        return res.status(400).json({
          error: `All ${warnedRows} staged row(s) carry warnings — include them or re-upload the workbook.`,
        });
      }
      discarded = rows.length - kept.length;
      rows = kept;
    }

    const lookups = await loadLookups();
    const period = batch.period_formatted || batch.period_month;
    const createdBy = req.user?.username || req.user?.email || 'system';

    // Which level each staged row sits at, taken from its category — this is
    // what tells the upline materialiser what to create for it.
    const levelById = {};
    for (const c of Object.values(lookups.catByCode)) levelById[c.id] = c.level;
    for (const r of rows) r.level = levelById[r.category_id] ?? r.level ?? null;

    // The short id and the moment this import ran travel with every user it
    // writes, so the registry can show where a record came from without a join
    // and the report can print "IMP-20260918-01 · 18 Sep 2026, 17:14".
    const importCode = batch.import_code || null;
    const importedAt = batch.created_at || new Date();

    // 1 — upsert the entity registry, counting new vs existing
    let inserted = 0;
    let updated = 0;
    for (const chunk of chunkArray(rows, CHUNK)) {
      const mobiles = chunk.map((r) => r.mobile);
      const [existing] = await pool.query(
        `SELECT mobile_number FROM channel_entities WHERE mobile_number IN (${mobiles.map(() => '?').join(',')})`,
        mobiles
      );
      const existingSet = new Set(existing.map((e) => e.mobile_number));
      inserted += chunk.filter((r) => !existingSet.has(r.mobile)).length;
      updated += chunk.filter((r) => existingSet.has(r.mobile)).length;

      const values = chunk.map((r) => [
        r.mobile, r.name, r.category_id, r.status || 'active', r.geo || null,
        r.product || DEFAULT_PRODUCT, r.parent_mobile || null, r.owner_mobile || null,
        r.business_type || null,
        r.tin || null, r.location || null, r.national_id || null,
        r.source || 'import', period, period,
        batchId, batchId, importCode, importedAt, createdBy,
      ]);

      // `last_batch_id` moves to whichever batch refreshed the user most
      // recently, so deleting a batch only takes the users it still owns — a
      // later import that also lists them keeps them alive.
      await pool.query(
        `INSERT INTO channel_entities
           (mobile_number, user_name, category_id, status, geo_domain_raw, product,
            parent_mobile, owner_mobile, business_type,
            tin, location, national_id,
            source, first_seen_period, last_seen_period,
            first_batch_id, last_batch_id, import_code, imported_at, created_by)
         VALUES ${values.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}
         ON DUPLICATE KEY UPDATE
           user_name = VALUES(user_name),
           category_id = VALUES(category_id),
           status = VALUES(status),
           geo_domain_raw = VALUES(geo_domain_raw),
           product = VALUES(product),
           parent_mobile = VALUES(parent_mobile),
           owner_mobile = VALUES(owner_mobile),
           business_type = COALESCE(VALUES(business_type), business_type),
           tin = COALESCE(VALUES(tin), tin),
           location = COALESCE(VALUES(location), location),
           national_id = COALESCE(VALUES(national_id), national_id),
           first_batch_id = IFNULL(first_batch_id, VALUES(first_batch_id)),
           last_batch_id = VALUES(last_batch_id),
           import_code = VALUES(import_code),
           imported_at = VALUES(imported_at),
           first_seen_period = IFNULL(LEAST(first_seen_period, VALUES(first_seen_period)), VALUES(first_seen_period)),
           last_seen_period = IFNULL(GREATEST(last_seen_period, VALUES(last_seen_period)), VALUES(last_seen_period)),
           updated_at = NOW()`,
        values.flat()
      );
    }

    // 1b — a level sheet names its uplines and carries their contact and region
    // inline, so materialise any the registry has never seen before linking.
    const uplines = await materialiseUplines(rows, lookups, period, createdBy, batchId, importCode, importedAt);

    // 2 — resolve the 3-level hierarchy now that every mobile exists
    const hierarchy = await resolveHierarchy(rows);

    // 2b — the file rows are now linked, but the uplines they named (auto-
    // created Sub-Distributors / Distributors) still sit with null parent_id /
    // owner_id.  Link them so the Distributor hierarchy view and the reports
    // show the correct child counts. The sub-distributor sheet's own
    // Distributor column is passed in explicitly — it outranks votes inferred
    // from retailer rows.
    const uplineSheetOwners = new Map(); // sub_mobile → distributor_mobile
    for (const r of rows) {
      if (r.level !== 2) continue;
      if (r.parent_mobile && r.owner_mobile && r.parent_mobile === r.owner_mobile) {
        uplineSheetOwners.set(r.mobile, r.owner_mobile);
      }
    }
    const uplineLinks = await resolveUplines(rows, uplineSheetOwners);

    // 2c — full-tree repair pass. `resolveHierarchy` only sees this file's
    // rows: a distributor deleted and re-registered between imports still
    // holds children whose FKs point at the dead id, and the distributor's
    // counts would read 0 forever. The relink re-attaches every row whose
    // mobile columns name a registered user, so the tree is whole after any
    // import, not just the rows this file carried.
    const relink = await relinkHierarchy();

    // 3 — balance time series removed
    // The Available Balance column has been removed from the import file.
    // Entity data is imported without stock figures; the hierarchy and
    // entity attributes (status, region, business type, etc.) are the
    // focus of the Indirect Channel module.

    const entityIds = await loadEntityIds(rows.map((r) => r.mobile));
    const balanceRows = [];

    // 4 — balance time series removed: no summary block to write
    const reconciliation = null;
    const summaryTotal = 0;
    const detailTotal = 0;

    await pool.query(
      `UPDATE channel_import_batches
          SET status = 'completed', inserted_rows = ?, updated_rows = ?, new_entities = ?,
              valid_rows = ?, warning_rows = ?, discarded_rows = ?, hierarchy_created = ?,
              detail_balance_total = 0, summary_balance_total = 0,
              reconciliation_variance = 0, summary_rows = 0, completed_at = NOW()
        WHERE id = ?`,
      [inserted, updated, inserted, rows.length, warnedRows, discarded, uplines.created, batchId]
    );

    // The staged rows have served their purpose — the batch is committed now.
    await pool.query('DELETE FROM channel_import_rows WHERE batch_id = ?', [batchId]);

    // New users (and any uplines this file created) get their identifier code
    // as part of the commit, so every list shows one straight away.
    const coded = await assignIdentifierCodes();

    invalidate('/channel');

    res.json({
      message: 'Import committed',
      batch_id: batchId,
      period_month: period,
      inserted_entities: inserted,
      updated_entities: updated,
      rows_committed: rows.length,
      warned_rows: warnedRows,
      discarded_rows: discarded,
      balances_written: balanceRows.length,
      hierarchy,
      hierarchy_created: uplines.created,
      hierarchy_created_mobiles: uplines.mobiles,
      hierarchy_linked: uplineLinks.linked,
      hierarchy_relinked: relink.fixed,
      identifiers_assigned: coded,
      reconciliation,
      detail_balance_total: round2(detailTotal),
      summary_balance_total: round2(summaryTotal),
      reconciliation_variance: round2(summaryTotal - detailTotal),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Batch history ─────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    await ensureChannelSchema();
    // `owned_entities` is what the Delete button would remove right now — the
    // users this import still owns. It drops when a later import refreshes them,
    // so the history shows what deleting the batch would actually cost.
    const [rows] = await pool.query(
      `SELECT b.id, b.import_code, b.filename,
              DATE_FORMAT(b.period_month, '%Y-%m-%d') AS period_month,
              b.total_rows, b.valid_rows, b.inserted_rows, b.updated_rows, b.duplicate_rows,
              b.rejected_rows, b.warning_rows, b.discarded_rows,
              b.new_entities, b.detail_balance_total, b.summary_balance_total,
              b.reconciliation_variance, b.summary_rows, b.status, b.error_log, b.imported_by,
              b.created_at, b.completed_at,
              (SELECT COUNT(*) FROM channel_import_errors e
                WHERE e.batch_id = b.id AND e.severity = 'duplicate') AS duplicate_rows_logged,
              (SELECT COUNT(*) FROM channel_entities en
                WHERE en.last_batch_id = b.id) AS owned_entities
         FROM channel_import_batches b
        ORDER BY b.created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/errors', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { severity, limit = 500 } = req.query;
    const where = ['batch_id = ?'];
    const params = [req.params.id];
    if (severity) { where.push('severity = ?'); params.push(severity); }

    const [rows] = await pool.query(
      `SELECT id, sheet_name, row_num, severity, reason, raw_data
         FROM channel_import_errors WHERE ${where.join(' AND ')}
        ORDER BY severity = 'reject' DESC, row_num ASC LIMIT ?`,
      [...params, parseInt(limit, 10) || 500]
    );
    const [counts] = await pool.query(
      'SELECT severity, COUNT(*) AS c FROM channel_import_errors WHERE batch_id = ? GROUP BY severity', [req.params.id]
    );
    res.json({ errors: rows, counts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete registry rows in chunks.
 *
 * A batch import can create a hundred thousand users, and MySQL will not take
 * that as one statement — so the ids are paged and deleted 5,000 at a time, the
 * same way the balance rows are.
 */
async function deleteEntitiesWhere(conn, predicate, params) {
  const PAGE = 5000;
  let removed = 0;
  for (;;) {
    const [r] = await conn.query(
      `DELETE e FROM channel_entities e
        INNER JOIN (SELECT id FROM channel_entities
                     WHERE ${predicate} LIMIT ${PAGE}) AS del
        ON e.id = del.id`,
      params
    );
    removed += r.affectedRows;
    if (r.affectedRows < PAGE) break;
  }
  if (removed) { await detachDanglingLinks(conn); await dropOrphanBalances(conn); }
  return removed;
}

/**
 * Drop balance rows whose user no longer exists.
 *
 * A balance table can hold rows the batch-delete filter does not match — a
 * manually corrected figure, or a placeholder written before the batch id was
 * stamped on — and once the user is gone those rows would sit in the reports as
 * stock with nobody attached to it.
 */
async function dropOrphanBalances(conn) {
  await conn.query(
    `DELETE b FROM channel_stock_balances b
       LEFT JOIN channel_entities e ON e.id = b.entity_id
      WHERE e.id IS NULL`
  );
}

/**
 * Clear parent_id / owner_id pointing at a user who no longer exists.
 *
 * `channel_entities` references itself, so removing a Distributor (or any other
 * upline) would otherwise leave its surviving children linked to a dead row —
 * which the hierarchy walk and the reports would then try to read.
 */
async function detachDanglingLinks(conn) {
  await conn.query(
    `UPDATE channel_entities e
       LEFT JOIN channel_entities p ON p.id = e.parent_id
       LEFT JOIN channel_entities o ON o.id = e.owner_id
        SET e.parent_id = IF(p.id IS NULL, NULL, e.parent_id),
            e.owner_id  = IF(o.id IS NULL, NULL, e.owner_id)
      WHERE (e.parent_id IS NOT NULL AND p.id IS NULL)
         OR (e.owner_id  IS NOT NULL AND o.id IS NULL)`
  );
}

/**
 * Remove every imported registry row and all import history — the clean slate.
 *
 * Only rows that arrived through an import are touched: a user registered by
 * hand (`source = 'manual'`) keeps its record, though any upline link it held
 * into the imported hierarchy is cleared.
 */
router.delete('/registry', async (req, res) => {
  if (!isMasterAdmin(req)) {
    return res.status(403).json({ error: 'Only the master administrator can clear imported data' });
  }
  const conn = await pool.getConnection();
  try {
    await ensureChannelSchema();
    await conn.query('SET SESSION net_write_timeout = 600');
    await conn.query('SET SESSION net_read_timeout = 600');
    await conn.query('SET SESSION wait_timeout = 600');

    const [counts] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM channel_entities WHERE source = 'import') AS entities,
              (SELECT COUNT(*) FROM channel_stock_balances) AS balances`
    );

    await conn.query('DELETE FROM channel_stock_balances');
    await conn.query('DELETE FROM channel_stock_summary');
    await conn.query('DELETE FROM channel_import_rows');
    await conn.query('DELETE FROM channel_import_errors');
    await conn.query('DELETE FROM channel_import_batches');
    const entities = await deleteEntitiesWhere(conn, "source = 'import'", []);

    conn.release();
    invalidate('/channel');
    res.json({
      message: 'Imported data removed',
      entities_deleted: entities,
      balances_deleted: Number(counts[0].balances) || 0,
      note: 'Users registered by hand were kept.',
    });
  } catch (error) {
    conn.release();
    res.status(500).json({ error: error.message });
  }
});

/** Remove a batch and everything it wrote (manually entered rows are kept). */
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureChannelSchema();
    await conn.query('SET SESSION net_write_timeout = 600');
    await conn.query('SET SESSION net_read_timeout = 600');
    await conn.query('SET SESSION wait_timeout = 600');

    const [batches] = await conn.query('SELECT * FROM channel_import_batches WHERE id = ?', [req.params.id]);
    if (!batches.length) { conn.release(); return res.status(404).json({ error: 'Import batch not found' }); }

    const batchId = req.params.id;
    const CHUNK = 5000;
    let totalBal = 0;

    // Chunked delete for stock_balances (can be 100K+ rows)
    while (true) {
      const [r] = await conn.query(
        `DELETE b FROM channel_stock_balances b
          INNER JOIN (SELECT id FROM channel_stock_balances
                      WHERE import_batch_id = ? AND source = 'import' LIMIT ?) AS del
          ON b.id = del.id`,
        [batchId, CHUNK]
      );
      totalBal += r.affectedRows;
      if (r.affectedRows < CHUNK) break;
    }

    await conn.query(
      "DELETE FROM channel_stock_summary WHERE import_batch_id = ? AND source = 'import'", [batchId]
    );

    // Chunked delete for import_rows (can also be large)
    while (true) {
      const [r] = await conn.query(
        `DELETE ri FROM channel_import_rows ri
          INNER JOIN (SELECT id FROM channel_import_rows
                      WHERE batch_id = ? LIMIT ?) AS del
          ON ri.id = del.id`,
        [batchId, CHUNK]
      );
      if (r.affectedRows < CHUNK) break;
    }

    await conn.query('DELETE FROM channel_import_errors WHERE batch_id = ?', [batchId]);

    // The batch row itself goes BEFORE the entity pass, so the
    // `NOT IN (SELECT id FROM channel_import_batches)` clauses below see it as
    // already gone.
    await conn.query('DELETE FROM channel_import_batches WHERE id = ?', [batchId]);

    // The users this batch still owns go with it. Ownership is `last_batch_id`:
    // once a later import has refreshed a user, deleting an older file leaves it
    // standing — and a user an earlier, surviving batch introduced is kept too,
    // because that file is still on the register.
    //
    // That keep-alive rule has a hole: a row kept alive by its introducing batch
    // loses that protection when the introducing batch is deleted LATER — its
    // references end up pointing at two dead batches, owned by nothing, and the
    // main pass can never see it again. The dead-batch sweep after the batch
    // row removal below closes the hole (it must run after removal so it can
    // see which batches are truly gone).

    // ── Adoption ──────────────────────────────────────────────────────────
    // The dying batch may EXCLUSIVELY own uplines (a distributor or
    // sub-distributor only it listed) that surviving rows still point at as
    // parent/owner. Deleting them orphaned every kept retailer's hierarchy and
    // made the reports read wrong — deleting one import must not damage what
    // another import still claims. Any candidate still referenced by a row
    // that will survive is therefore handed to the newest surviving batch.
    // The loop walks up the chain (retailer → sub → distributor): adopting a
    // sub can make its distributor referenced-by-a-survivor on the next pass.
    const [[adopter]] = await conn.query(
      'SELECT id, import_code FROM channel_import_batches ORDER BY created_at DESC LIMIT 1'
    );
    let adopted = 0;
    if (adopter) {
      for (;;) {
        const [refs] = await conn.query(
          `SELECT DISTINCT c.id
             FROM channel_entities c
             JOIN channel_entities s ON s.parent_id = c.id OR s.owner_id = c.id
            WHERE c.last_batch_id = ?
              AND (c.first_batch_id IS NULL
                   OR c.first_batch_id = ?
                   OR c.first_batch_id NOT IN (SELECT id FROM channel_import_batches))
              AND s.id <> c.id
              AND (s.last_batch_id IS NULL OR s.last_batch_id <> ?
                   OR (s.first_batch_id IS NOT NULL
                       AND s.first_batch_id IN (SELECT id FROM channel_import_batches)))`,
          [batchId, batchId, batchId]
        );
        if (!refs.length) break;
        const ids = refs.map((r) => r.id);
        // Re-point the dying-batch ownership to the adopter; a dead
        // first_batch_id stays for the re-point pass below.
        await conn.query(
          `UPDATE channel_entities
              SET last_batch_id = ?,
                  first_batch_id = COALESCE(NULLIF(first_batch_id, ?), ?),
                  import_code = ?
            WHERE id IN (${ids.map(() => '?').join(',')})`,
          [adopter.id, batchId, adopter.id, adopter.import_code, ...ids]
        );
        adopted += ids.length;
      }
    }

    const entitiesDeleted = await deleteEntitiesWhere(
      conn,
      `last_batch_id = ?
         AND (first_batch_id IS NULL
              OR first_batch_id = ?
              OR first_batch_id NOT IN (SELECT id FROM channel_import_batches))`,
      [batchId, batchId]
    );

    // Sweep rows an earlier out-of-order delete orphaned: imported rows whose
    // EVERY batch reference (first and last) points at batches that no longer
    // exist. They are the "deleted the history but data still shows" ghosts —
    // no surviving file claims them, so nothing else can ever remove them.
    // Runs BEFORE the re-point pass below: a ghost must not be rescued into
    // the adopter's batch, it must be deleted.
    const swept = await deleteEntitiesWhere(
      conn,
      `source = 'import'
         AND (last_batch_id IS NOT NULL OR first_batch_id IS NOT NULL)
         AND (last_batch_id IS NULL OR last_batch_id NOT IN (SELECT id FROM (SELECT id FROM channel_import_batches) x))
         AND (first_batch_id IS NULL OR first_batch_id NOT IN (SELECT id FROM (SELECT id FROM channel_import_batches) y))`,
      []
    );

    // ── Re-point stale batch references on the survivors ─────────────────
    // A row kept alive by a surviving file can still carry a first_batch_id
    // naming a DELETED batch (introduced by file A, refreshed by file B, then
    // A deleted): its "first imported" provenance reads blank and no future
    // delete's bookkeeping can see it. The newest surviving batch adopts it.
    // After the ghost sweep, so genuinely orphaned rows are deleted rather
    // than silently re-homed.
    if (adopter) {
      await conn.query(
        `UPDATE channel_entities e
           JOIN (SELECT id FROM channel_entities
                  WHERE source = 'import' AND first_batch_id IS NOT NULL
                    AND first_batch_id NOT IN (SELECT id FROM (SELECT id FROM channel_import_batches) x)) d
             ON d.id = e.id
            SET e.first_batch_id = ?, e.import_code = ?`,
        [adopter.id, adopter.import_code]
      );
      await conn.query(
        `UPDATE channel_entities e
           JOIN (SELECT id FROM channel_entities
                  WHERE source = 'import' AND last_batch_id IS NOT NULL
                    AND last_batch_id NOT IN (SELECT id FROM (SELECT id FROM channel_import_batches) y)) d
             ON d.id = e.id
            SET e.last_batch_id = ?, e.import_code = ?`,
        [adopter.id, adopter.import_code]
      );
    }

    conn.release();
    invalidate('/channel');
    res.json({
      message: 'Batch removed',
      balances_deleted: totalBal,
      entities_deleted: entitiesDeleted,
      ghosts_swept: swept,
      adopted: adopted,
    });
  } catch (error) {
    conn.release();
    res.status(500).json({ error: error.message });
  }
});

/**
 * Edit a committed batch's period (and label). Because the period is the
 * "as of" key of the snapshot dataset, moving it means relocating the balance
 * and summary rows the batch wrote — any rows already occupying the target
 * period for the same entity/product are replaced, mirroring the idempotent
 * upsert used at import time.
 */
router.put('/:id', async (req, res) => {
  try {
    await ensureChannelSchema();
    const { period_month: requestedPeriod, filename } = req.body || {};

    const [batches] = await pool.query('SELECT * FROM channel_import_batches WHERE id = ?', [req.params.id]);
    if (!batches.length) return res.status(404).json({ error: 'Import batch not found' });
    const batch = batches[0];

    const newFilename = filename !== undefined ? clean(filename).slice(0, 255) : batch.filename;
    const newPeriod = requestedPeriod !== undefined ? normalizePeriod(requestedPeriod) : batch.period_month;
    if (!newPeriod) {
      return res.status(400).json({ error: 'A valid period (YYYY-MM) is required' });
    }

    let moved = 0;
    let summariesMoved = 0;

    // Only relocate rows when the period actually changes.
    if (String(newPeriod) !== String(batch.period_month)) {
      // Balances — replace anything already sitting on the target period for the
      // same entity + product, then move the batch's own rows.
      const [conflicts] = await pool.query(
        `DELETE target FROM channel_stock_balances target
           JOIN channel_stock_balances src
             ON src.entity_id = target.entity_id AND src.product = target.product
          WHERE target.period_month = ? AND src.import_batch_id = ? AND src.source = 'import'`,
        [newPeriod, batch.id]
      );
      const [balanceMove] = await pool.query(
        "UPDATE channel_stock_balances SET period_month = ?, updated_at = NOW() WHERE import_batch_id = ? AND source = 'import'",
        [newPeriod, batch.id]
      );
      moved = balanceMove.affectedRows;

      // Summary block — same collision handling on (period, domain, label).
      await pool.query(
        `DELETE target FROM channel_stock_summary target
           JOIN channel_stock_summary src
             ON src.domain_id = target.domain_id AND src.category_label = target.category_label
          WHERE target.period_month = ? AND src.import_batch_id = ? AND src.source = 'import'`,
        [newPeriod, batch.id]
      );
      const [summaryMove] = await pool.query(
        "UPDATE channel_stock_summary SET period_month = ? WHERE import_batch_id = ? AND source = 'import'",
        [newPeriod, batch.id]
      );
      summariesMoved = summaryMove.affectedRows;
    }

    // Recompute the reconciled totals for the (possibly new) period so history
    // and the dashboard stay consistent.
    const detailTotal = await detailTotalForPeriod(newPeriod);
    const [sumRow] = await pool.query(
      'SELECT COALESCE(SUM(stock_balance), 0) AS total, COUNT(*) AS n FROM channel_stock_summary WHERE period_month = ?',
      [newPeriod]
    );
    const summaryTotal = Number(sumRow[0].total) || 0;

    await pool.query(
      `UPDATE channel_import_batches
          SET filename = ?, period_month = ?, detail_balance_total = ?,
              summary_balance_total = ?, summary_rows = ?, reconciliation_variance = ?
        WHERE id = ?`,
      [newFilename, newPeriod, round2(detailTotal), round2(summaryTotal),
        Number(sumRow[0].n) || batch.summary_rows, round2(summaryTotal - detailTotal), batch.id]
    );

    invalidate('/channel');

    res.json({
      message: 'Import batch updated',
      id: batch.id,
      filename: newFilename,
      previous_period: batch.period_month,
      period_month: newPeriod,
      balances_moved: moved,
      summaries_moved: summariesMoved,
      conflict_balances_replaced: conflicts?.affectedRows || 0,
      detail_balance_total: round2(detailTotal),
      summary_balance_total: round2(summaryTotal),
      reconciliation_variance: round2(summaryTotal - detailTotal),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function round2(n) {
  const v = Number(n) || 0;
  return Math.round(v * 100) / 100;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizePeriod(v) {
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) m = s.match(/^(\d{4})-(\d{1,2})-\d{1,2}$/);
  if (!m) m = s.match(/^(\d{4})\/(\d{1,2})/);
  if (!m) return null;
  const mm = String(m[2]).padStart(2, '0');
  if (Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${mm}-01`;
}

function summariseErrors(errors) {
  const out = {};
  for (const e of errors) {
    const k = `${e.severity}:${e.reason}`;
    out[k] = (out[k] || 0) + 1;
  }
  return Object.entries(out)
    .map(([k, c]) => {
      const [severity, reason] = k.split(':');
      return { severity, reason, count: c };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

async function storeErrors(batchId, errors) {
  if (!errors.length) return;
  const limited = errors.slice(0, MAX_STORED_ERRORS);
  for (const chunk of chunkArray(limited, CHUNK)) {
    const values = chunk.map((e) => [
      batchId, (e.sheet_name || '').slice(0, 150), e.row_num || null,
      e.severity || 'reject', (e.reason || '').slice(0, 255),
      e.raw_data ? JSON.stringify(e.raw_data).slice(0, 2000) : null,
    ]);
    await pool.query(
      `INSERT INTO channel_import_errors (batch_id, sheet_name, row_num, severity, reason, raw_data)
       VALUES ${values.map(() => '(?,?,?,?,?,?)').join(',')}`,
      values.flat()
    );
  }
}

/**
 * Park the rows /preview accepted against their batch.
 *
 * Only the fields /confirm needs are kept — the workbook is not stored, so this
 * table is the single source of truth for what the batch will write.
 */
async function stageRows(batchId, rows) {
  if (!rows.length) return;
  for (const chunk of chunkArray(rows, CHUNK)) {
    const values = chunk.map((r) => [
      batchId, (r.sheet || '').slice(0, 150), r.row || null, r.mobile,
      (r.name || '').slice(0, 255), r.category_id, r.status || 'active',
      r.geo || null, (r.product || DEFAULT_PRODUCT).slice(0, 150),
      r.parent_mobile || null, r.owner_mobile || null,
      (r.business_type || '').slice(0, 150) || null,
      (r.parent_name || '').slice(0, 255) || null,
      (r.owner_name || '').slice(0, 255) || null,
      (r.owner_region || '').slice(0, 150) || null,
      (r.tin || '').slice(0, 50) || null,
      (r.location || '').slice(0, 255) || null,
      (r.national_id || '').slice(0, 50) || null,
      round2(r.balance),
      r.has_warning ? 1 : 0,
    ]);
    await pool.query(
      `INSERT INTO channel_import_rows
         (batch_id, sheet_name, row_num, mobile_number, user_name, category_id,
          status, geo_domain_raw, product, parent_mobile, owner_mobile,
          business_type, parent_name, owner_name, owner_region,
          tin, location, national_id, available_balance, has_warning)
       VALUES ${values.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
      values.flat()
    );
  }
}

/** Read a batch's staged rows back in the shape the confirm step expects. */
async function loadStagedRows(batchId) {
  const [rows] = await pool.query(
    `SELECT sheet_name, row_num, mobile_number, user_name, category_id, status,
            geo_domain_raw, product, parent_mobile, owner_mobile, business_type,
            parent_name, owner_name, owner_region, tin, location, national_id,
            available_balance, has_warning
       FROM channel_import_rows WHERE batch_id = ? ORDER BY id`,
    [batchId]
  );
  return rows.map((r) => ({
    sheet: r.sheet_name,
    row: r.row_num,
    name: r.user_name,
    mobile: r.mobile_number,
    category_id: r.category_id,
    status: r.status,
    geo: r.geo_domain_raw,
    product: r.product,
    parent_name: r.parent_name,
    parent_mobile: r.parent_mobile,
    owner_name: r.owner_name,
    owner_mobile: r.owner_mobile,
    owner_region: r.owner_region,
    business_type: r.business_type,
    tin: r.tin,
    location: r.location,
    national_id: r.national_id,
    balance: Number(r.available_balance) || 0,
    has_warning: Boolean(r.has_warning),
  }));
}

async function loadEntityIds(mobiles) {
  const map = {};
  const unique = [...new Set(mobiles.filter(Boolean))];
  for (const chunk of chunkArray(unique, CHUNK)) {
    const [rows] = await pool.query(
      `SELECT id, mobile_number FROM channel_entities WHERE mobile_number IN (${chunk.map(() => '?').join(',')})`,
      chunk
    );
    for (const r of rows) map[r.mobile_number] = r.id;
  }
  return map;
}

/**
 * Create the Distributor / Sub-Distributor rows a level sheet names but the
 * registry has never seen.
 *
 * Only rows that came from a level layout take part (`level` is set), so a
 * generic workbook keeps its long-standing behaviour of merely warning about an
 * unknown upline. The category of a created upline follows the level *below* the
 * referencing row: a retailer's parent is a sub-distributor, a sub-distributor's
 * owner is a distributor.
 *
 * Each created upline also gets a zero balance row for the period. Without one
 * the new level is invisible to every balance-driven dashboard and report — the
 * source summary sheet reports those levels as 0 too, so this mirrors it.
 */
async function materialiseUplines(rows, lookups, period, createdBy, batchId, importCode, importedAt) {
  const wanted = new Map();
  const note = (mobile, name, categoryCode, region, product) => {
    if (!mobile || !name || !categoryCode) return;
    if (!lookups.catByCode[categoryCode]) return;
    const prev = wanted.get(mobile);
    if (!prev) {
      wanted.set(mobile, {
        name, category_code: categoryCode,
        region: region || null, product: product || DEFAULT_PRODUCT,
      });
      return;
    }
    if (!prev.region && region) prev.region = region;
  };

  for (const r of rows) {
    if (!r.level) continue;
    if (r.level > 1 && r.parent_mobile && r.parent_name) {
      note(r.parent_mobile, r.parent_name, LEVEL_CATEGORY[r.level - 1], null, r.product);
    }
    if (r.level > 1 && r.owner_mobile && r.owner_name) {
      note(r.owner_mobile, r.owner_name, LEVEL_CATEGORY[1], r.owner_region, r.product);
    }
  }
  if (!wanted.size) return { created: 0, mobiles: [] };

  const mobiles = [...wanted.keys()];
  const known = await loadEntityIds(mobiles);
  const missing = mobiles.filter((m) => !known[m]);
  if (!missing.length) return { created: 0, mobiles: [] };

  const values = missing.map((m) => {
    const info = wanted.get(m);
    return [
      m, info.name.slice(0, 255), lookups.catByCode[info.category_code].id, 'active',
      info.region, info.product.slice(0, 150), 'import', period, period,
      batchId || null, batchId || null, importCode || null, importedAt || null,
      1, createdBy, 'Upline named by a batch import',
    ];
  });

  // INSERT IGNORE: another row in the same file may already have created it.
  for (const chunk of chunkArray(values, CHUNK)) {
    await pool.query(
      `INSERT IGNORE INTO channel_entities
         (mobile_number, user_name, category_id, status, geo_domain_raw, product,
          source, first_seen_period, last_seen_period,
          first_batch_id, last_batch_id, import_code, imported_at,
          is_inferred, created_by, notes)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
      chunk.flat()
    );
  }

  const created = await loadEntityIds(missing);
  const balanceValues = missing.filter((m) => created[m]).map((m) => [
    created[m], period, (wanted.get(m).product || DEFAULT_PRODUCT).slice(0, 150), 0,
    batchId || null,
  ]);
  for (const chunk of chunkArray(balanceValues, CHUNK)) {
    // A real balance already on file always wins over the placeholder zero.
    // The batch id is stamped on so deleting the batch takes the placeholders
    // with it — an untagged row would outlive the user it belongs to.
    await pool.query(
      `INSERT INTO channel_stock_balances
         (entity_id, period_month, product, available_balance, source, import_batch_id)
       VALUES ${chunk.map(() => "(?,?,?,?,'import',?)").join(',')}
       ON DUPLICATE KEY UPDATE available_balance = available_balance`,
      chunk.flat()
    );
  }

  return { created: balanceValues.length, mobiles: missing };
}

/**
 * parent = immediate upline, owner = the distributor at the top of the chain.
 * When the file omits an owner (direct children), the parent *is* the owner.
 */
async function resolveHierarchy(rows) {
  const allMobiles = new Set();
  for (const r of rows) {
    if (r.mobile) allMobiles.add(r.mobile);
    if (r.parent_mobile) allMobiles.add(r.parent_mobile);
    if (r.owner_mobile) allMobiles.add(r.owner_mobile);
  }

  // id + current hierarchy for every mobile involved, in chunks
  const byMobile = {};
  const all = [...allMobiles];
  for (const chunk of chunkArray(all, CHUNK)) {
    const [found] = await pool.query(
      `SELECT id, mobile_number, parent_id, owner_id FROM channel_entities
        WHERE mobile_number IN (${chunk.map(() => '?').join(',')})`,
      chunk
    );
    for (const f of found) byMobile[f.mobile_number] = f;
  }

  let resolved = 0;
  let unresolved = 0;
  let unchanged = 0;
  const updates = [];

  for (const r of rows) {
    const self = byMobile[r.mobile];
    if (!self) continue;

    const parentId = r.parent_mobile ? byMobile[r.parent_mobile]?.id || null : null;
    let ownerId = r.owner_mobile ? byMobile[r.owner_mobile]?.id || null : null;

    // Direct children: the file repeats the owner, but if it is absent the
    // parent sits at the top of the chain.
    if (!ownerId && parentId) {
      ownerId = byMobile[r.parent_mobile]?.owner_id || parentId;
    }

    if (r.parent_mobile && !parentId) unresolved++;
    if (!parentId && !ownerId) continue;

    if (self.parent_id === parentId && self.owner_id === ownerId) { unchanged++; continue; }
    updates.push([parentId, ownerId, self.id]);
    resolved++;
  }

  for (const chunk of chunkArray(updates, CHUNK)) {
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const ids = chunk.map(([, , id]) => id);
    const parentCases = chunk.map(([p]) => p);
    const ownerCases = chunk.map(([, o]) => o);
    await pool.query(
      `UPDATE channel_entities
          SET parent_id = CASE id ${cases} END,
              owner_id  = CASE id ${cases} END
        WHERE id IN (${ids.map(() => '?').join(',')})`,
      [...ids.flatMap((id, i) => [id, parentCases[i]]),
        ...ids.flatMap((id, i) => [id, ownerCases[i]]),
        ...ids]
    );
  }

  return { resolved, unchanged, unresolved_parents: unresolved };
}

/**
 * Link the auto-created uplines (Sub-Distributors, Distributors) to each other.
 *
 * `resolveHierarchy` only processes the file's own rows (retailers), so it
 * never touches an upline's parent_id / owner_id. A Sub-Distributor created by
 * `materialiseUplines` therefore sits in the registry with null links, which
 * makes the Distributor hierarchy view and the sub-distributor report show zero
 * children.
 *
 * The retailer rows carry enough information to reconstruct the full chain:
 *   retailer.parent_mobile  → Sub-Distributor
 *   retailer.owner_mobile   → Distributor
 *
 * IMPORTANT — the ownership model this must respect: a Sub-Distributor's
 * retailers can be OWNED by several different distributors (the IDC file shows
 * exactly that — one sub's ten retailers name ten distributors). So a sub is
 * linked to only ONE distributor: its plurality owner across its retailers,
 * with the sub-distributor sheet's explicit Distributor column outranking the
 * vote. The OTHER distributors still own their individual retailers file-exact
 * — the distributor's "Sub-Distributors I work through" count reads the
 * distinct parents of the retailers it owns, so nobody drops to 0 from this
 * single-link limitation.
 */
async function resolveUplines(rows, uplineSheetOwners) {
  // Sub-Distributor → Distributor votes, one per retailer row.
  const votes = new Map(); // sub_dist_mobile → Map(distributor_mobile → count)
  for (const r of rows) {
    if (!r.level || r.level < 3 || !r.parent_mobile || !r.owner_mobile) continue;
    // The owner_mobile is the distributor; the parent_mobile is the sub-distributor.
    if (r.parent_mobile === r.owner_mobile) continue; // direct children, no sub-dist link
    if (!votes.has(r.parent_mobile)) votes.set(r.parent_mobile, new Map());
    const tally = votes.get(r.parent_mobile);
    tally.set(r.owner_mobile, (tally.get(r.owner_mobile) || 0) + 1);
  }

  const linkPairs = new Map(); // sub_dist_mobile → distributor_mobile (plurality)
  for (const [subMobile, tally] of votes) {
    let best = null;
    let bestN = -1;
    for (const [distMobile, n] of tally) {
      if (n > bestN) { best = distMobile; bestN = n; }
    }
    // The sub sheet's explicit Distributor column outranks the inferred vote.
    const sheetOwner = uplineSheetOwners?.get(subMobile);
    if (sheetOwner) best = sheetOwner;
    if (best) linkPairs.set(subMobile, best);
  }
  // Subs named by the sheet but absent from the votes (no retailer rows in
  // this file) still get their explicit owner.
  for (const [subMobile, distMobile] of uplineSheetOwners || []) {
    if (!linkPairs.has(subMobile) && distMobile) linkPairs.set(subMobile, distMobile);
  }
  if (!linkPairs.size) return { linked: 0 };

  const allMobiles = [...new Set([...linkPairs.keys(), ...linkPairs.values()])];
  const byMobile = {};
  for (const chunk of chunkArray(allMobiles, CHUNK)) {
    const [found] = await pool.query(
      `SELECT id, mobile_number FROM channel_entities WHERE mobile_number IN (${chunk.map(() => '?').join(',')})`,
      chunk
    );
    for (const f of found) byMobile[f.mobile_number] = f.id;
  }

  const updates = [];
  for (const [subMobile, distMobile] of linkPairs) {
    const subId = byMobile[subMobile];
    const distId = byMobile[distMobile];
    if (!subId || !distId) continue;
    updates.push([distId, distId, subId]);
  }
  if (!updates.length) return { linked: 0 };

  let linked = 0;
  for (const chunk of chunkArray(updates, CHUNK)) {
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const ids = chunk.map(([, , id]) => id);
    await pool.query(
      `UPDATE channel_entities
          SET parent_id = CASE id ${cases} END,
              owner_id  = CASE id ${cases} END
        WHERE id IN (${ids.map(() => '?').join(',')})`,
      [...ids.flatMap((id, i) => [id, chunk[i][0]]),
        ...ids.flatMap((id, i) => [id, chunk[i][1]]),
        ...ids]
    );
    linked += chunk.length;
  }
  return { linked };
}

async function detailTotalForPeriod(period) {
  const [rows] = await pool.query(
    'SELECT COALESCE(SUM(available_balance), 0) AS total FROM channel_stock_balances WHERE period_month = ?',
    [period]
  );
  return Number(rows[0].total) || 0;
}

/** The first day of the current month, in the same shape normalizePeriod returns. */
function currentMonthPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Detail sums per domain+level vs the summary block, for one period. */
async function reconcilePeriod(period) {
  const [rows] = await pool.query(
    `SELECT d.code AS domain_code, d.name AS domain_name, c.level, c.code AS category_code, c.name AS category_name,
            COUNT(DISTINCT b.entity_id) AS entities, COALESCE(SUM(b.available_balance), 0) AS detail_total
       FROM channel_stock_balances b
       JOIN channel_entities e ON e.id = b.entity_id
       JOIN channel_categories c ON c.id = e.category_id
       JOIN channel_domains d ON d.id = c.domain_id
      WHERE b.period_month = ?
      GROUP BY d.code, d.name, c.level, c.code, c.name
      ORDER BY d.sort_order, c.level`,
    [period]
  );

  const [sums] = await pool.query(
    `SELECT d.code AS domain_code, s.category_label, s.level, s.stock_balance
       FROM channel_stock_summary s JOIN channel_domains d ON d.id = s.domain_id
      WHERE s.period_month = ?`,
    [period]
  );
  const summaryByKey = {};
  for (const s of sums) summaryByKey[`${s.domain_code}|${s.category_label.toUpperCase()}`] = Number(s.stock_balance);

  return rows.map((r) => {
    const label = r.category_name;
    const summary = summaryByKey[`${r.domain_code}|${String(label).toUpperCase()}`];
    return {
      domain_code: r.domain_code,
      domain_name: r.domain_name,
      level: r.level,
      category_code: r.category_code,
      category_label: label,
      entities: Number(r.entities),
      detail_total: round2(r.detail_total),
      summary_total: summary === undefined ? null : round2(summary),
      variance: summary === undefined ? null : round2(summary - r.detail_total),
    };
  });
}

module.exports = router;
module.exports.parseWorkbook = parseWorkbook;
module.exports.loadLookups = loadLookups;
module.exports.normalizePeriod = normalizePeriod;
module.exports.round2 = round2;
module.exports.buildTemplateWorkbook = buildTemplateWorkbook;
