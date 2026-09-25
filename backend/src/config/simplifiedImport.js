const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
require('../env');

// For each sheet, define column indices for: [partnerName, totalRevenue, ethioShare, month]
const SHEET_CONFIG = {
  'Premium SMS MT':      { service: 'Premium SMS MT',        partnerCol: 1, revenueCol: 3, ethioCol: 4, month: '2024-08', dataStart: 3 },
  'CSA':                 { service: 'CSA',                   partnerCol: 1, revenueCol: 2, ethioCol: 3, month: '2024-08', dataStart: 3 },
  'API with MA':         { service: 'API with MA',           partnerCol: 1, revenueCol: 3, ethioCol: 4, month: '2024-07', dataStart: 4 },
  'Voice_Premium':       { service: 'Voice Premium',         partnerCol: 1, revenueCol: 3, ethioCol: 4, month: '2024-08', dataStart: 2 },
  'API- Call Signature': { service: 'API Call Signature',    partnerCol: 1, revenueCol: 2, ethioCol: 3, month: '2025-01', dataStart: 3 },
  'API-Mega Promo 130':  { service: 'API Mega Promo 130',   partnerCol: 2, revenueCol: 3, ethioCol: 4, month: '2025-01', dataStart: 3 },
  'API with MA ':        { service: 'API with MA (New)',     partnerCol: 1, revenueCol: 2, ethioCol: 3, month: '2026-05', dataStart: 4 },
  'SMS-MO_Premium':      { service: 'SMS MO Premium',        partnerCol: 1, revenueCol: 3, ethioCol: 4, month: '2026-05', dataStart: 3 },
  'Voice_Premium_':      { service: 'Voice Premium (New)',   partnerCol: 1, revenueCol: 3, ethioCol: 4, month: '2026-05', dataStart: 2 },
  'National Lottery ':   { service: 'National Lottery',      partnerCol: 1, revenueCol: 2, ethioCol: 3, month: '2026-05', dataStart: 2 },
  'Premium SMS MT ':     { service: 'Premium SMS MT (New)',  partnerCol: 2, revenueCol: 4, ethioCol: 5, month: '2026-05', dataStart: 3 },
  'CRBT-Partners':       { service: 'CRBT Partners',         partnerCol: 1, revenueCol: 4, ethioCol: 5, month: '2026-05', dataStart: 2 },
  'Voice':               { service: 'Voice Service',         partnerCol: 0, revenueCol: 1, ethioCol: 2, month: '2022-06', dataStart: 2 },
};

async function run() {
  // Drop old tables and create clean schema
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  console.log('✅ Connected to database');

  // Drop old tables
  await conn.query('DROP TABLE IF EXISTS partner_revenue');
  await conn.query('DROP TABLE IF EXISTS service_revenue_summary');
  await conn.query('DROP TABLE IF EXISTS vas_service_types');

  // Create clean table with only 5 fields
  await conn.query(`
    CREATE TABLE partner_revenue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      partner_name VARCHAR(500) NOT NULL,
      service_name VARCHAR(255) NOT NULL,
      total_revenue DECIMAL(15, 2) NOT NULL DEFAULT 0,
      ethio_share DECIMAL(15, 2) DEFAULT NULL,
      revenue_month VARCHAR(10) NOT NULL,
      import_batch_id VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_service (service_name),
      INDEX idx_month (revenue_month),
      INDEX idx_partner (partner_name(100)),
      INDEX idx_revenue (total_revenue)
    )
  `);

  await conn.query(`
    CREATE TABLE service_revenue_summary (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_name VARCHAR(255) NOT NULL,
      revenue_month VARCHAR(10) NOT NULL,
      total_revenue DECIMAL(15, 2) NOT NULL DEFAULT 0,
      total_ethio_share DECIMAL(15, 2) DEFAULT NULL,
      partner_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_service_month (service_name, revenue_month)
    )
  `);

  console.log('✅ Clean tables created');

  // Read Excel
  const filePath = 'C:/Users/abayneh.mekonnen/Desktop/OLD File/disk D/disk D/May 2026/May 2026-all.xlsx';
  const workbook = XLSX.readFile(filePath);
  const batchId = uuidv4();
  let totalRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const config = SHEET_CONFIG[sheetName];
    if (!config) {
      console.log(`⚠️  No config for sheet: "${sheetName}" — skipping`);
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    let sheetTotal = 0;
    let sheetEthio = 0;
    let sheetPartners = 0;

    for (let i = config.dataStart; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const partnerName = String(row[config.partnerCol] || '').trim();
      const totalRevenue = parseFloat(row[config.revenueCol]) || 0;
      const ethioShare = parseFloat(row[config.ethioCol]) || null;

      // Skip empty rows, TOTAL rows, and zero revenue
      if (!partnerName) continue;
      if (partnerName.toUpperCase() === 'TOTAL') continue;
      if (totalRevenue <= 0) continue;

      // For CRBT: sum Monthly Rent + Tone Sales (cols 2+3 = total in col 4)
      // Already handled by revenueCol=4

      try {
        await conn.query(
          `INSERT INTO partner_revenue (partner_name, service_name, total_revenue, ethio_share, revenue_month, import_batch_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [partnerName.substring(0, 500), config.service, totalRevenue, ethioShare, config.month, batchId]
        );
        sheetTotal += totalRevenue;
        sheetEthio += (ethioShare || 0);
        sheetPartners++;
        totalRows++;
      } catch (err) {
        console.warn(`  ⚠️  Skip: ${partnerName.substring(0, 40)} — ${err.message}`);
      }
    }

    // Insert/update summary
    if (sheetPartners > 0) {
      await conn.query(
        `INSERT INTO service_revenue_summary (service_name, revenue_month, total_revenue, total_ethio_share, partner_count)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           total_revenue = total_revenue + VALUES(total_revenue),
           total_ethio_share = total_ethio_share + VALUES(total_ethio_share),
           partner_count = partner_count + VALUES(partner_count)`,
        [config.service, config.month, sheetTotal, sheetEthio || null, sheetPartners]
      );
    }

    console.log(`✅ ${config.service.padEnd(25)} — ETB ${sheetTotal.toLocaleString('en-US', { minimumFractionDigits: 2 }).padStart(15)}  (${sheetPartners} partners, ${config.month})`);
  }

  console.log(`\n🎉 Import complete: ${totalRows} rows`);

  // Print summary
  const [summaries] = await conn.query(
    `SELECT revenue_month, service_name, total_revenue, partner_count 
     FROM service_revenue_summary ORDER BY revenue_month DESC, total_revenue DESC`
  );

  console.log('\n=== Summary by Month ===');
  let currentMonth = '';
  let monthTotal = 0;
  for (const s of summaries) {
    if (s.revenue_month !== currentMonth) {
      if (currentMonth) console.log(`  ${currentMonth} TOTAL: ETB ${monthTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      currentMonth = s.revenue_month;
      monthTotal = 0;
      console.log(`\n📅 ${s.revenue_month}:`);
    }
    monthTotal += parseFloat(s.total_revenue);
    console.log(`  ${s.service_name.padEnd(25)} ETB ${parseFloat(s.total_revenue).toLocaleString('en-US', { minimumFractionDigits: 2 }).padStart(15)}  (${s.partner_count} partners)`);
  }
  if (currentMonth) console.log(`  ${currentMonth} TOTAL: ETB ${monthTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  await conn.end();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
