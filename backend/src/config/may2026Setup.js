const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
require('../env');

// Service type mapping from sheet names to clean service names
const SERVICE_MAP = {
  'Premium SMS MT': { name: 'Premium SMS MT', category: 'messaging', code: 'PSMS_MT' },
  'Premium SMS MT ': { name: 'Premium SMS MT (New)', category: 'messaging', code: 'PSMT_NEW' },
  'CSA': { name: 'CSA Service', category: 'enterprise', code: 'CSA' },
  'API with MA': { name: 'API with MA', category: 'enterprise', code: 'API_MA' },
  'API with MA ': { name: 'API with MA (New)', category: 'enterprise', code: 'API_MA_NEW' },
  'Voice_Premium': { name: 'Voice Premium', category: 'voice', code: 'VPREM' },
  'Voice_Premium_': { name: 'Voice Premium (New)', category: 'voice', code: 'VPREM_NEW' },
  'API- Call Signature': { name: 'API Call Signature', category: 'enterprise', code: 'API_CS' },
  'API-Mega Promo 130': { name: 'API Mega Promo 130', category: 'entertainment', code: 'API_MP130' },
  'SMS-MO_Premium': { name: 'SMS MO Premium', category: 'messaging', code: 'SMS_MO' },
  'National Lottery ': { name: 'National Lottery', category: 'entertainment', code: 'NAT_LOT' },
  'CRBT-Partners': { name: 'CRBT Partners', category: 'entertainment', code: 'CRBT' },
  'Voice': { name: 'Voice Service', category: 'voice', code: 'VOICE' },
};

async function setup() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  console.log('✅ Connected to database');

  // Create new tables
  await connection.query(`
    CREATE TABLE IF NOT EXISTS vas_service_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(50) UNIQUE NOT NULL,
      category VARCHAR(50) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS partner_revenue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_type_id INT NOT NULL,
      service_id VARCHAR(100),
      partner_name VARCHAR(500) NOT NULL,
      total_revenue DECIMAL(15, 2) NOT NULL,
      ethio_share DECIMAL(15, 2),
      partner_share DECIMAL(15, 2),
      ma_share DECIMAL(15, 2),
      revenue_sharing_model VARCHAR(100),
      status VARCHAR(50) DEFAULT 'validated',
      import_batch_id VARCHAR(36),
      revenue_period VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_type_id) REFERENCES vas_service_types(id) ON DELETE CASCADE
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS service_revenue_summary (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_type_id INT NOT NULL,
      revenue_period VARCHAR(20) NOT NULL,
      total_revenue DECIMAL(15, 2) NOT NULL,
      partner_count INT DEFAULT 0,
      ethio_total_share DECIMAL(15, 2),
      partner_total_share DECIMAL(15, 2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_type_id) REFERENCES vas_service_types(id) ON DELETE CASCADE,
      UNIQUE KEY unique_service_period (service_type_id, revenue_period)
    )
  `);

  await connection.query('CREATE INDEX idx_partner_service ON partner_revenue(service_type_id)');
  await connection.query('CREATE INDEX idx_partner_period ON partner_revenue(revenue_period)');
  await connection.query('CREATE INDEX idx_partner_revenue ON partner_revenue(total_revenue)');

  console.log('✅ Tables created');

  // Insert service types
  for (const [sheetName, info] of Object.entries(SERVICE_MAP)) {
    await connection.query(
      'INSERT IGNORE INTO vas_service_types (name, code, category) VALUES (?, ?, ?)',
      [info.name, info.code, info.category]
    );
  }
  console.log('✅ Service types inserted');

  // Process Excel file
  const filePath = 'C:/Users/abayneh.mekonnen/Desktop/OLD File/disk D/disk D/May 2026/May 2026-all.xlsx';
  const workbook = XLSX.readFile(filePath);
  const batchId = require('uuid').v4();

  let totalImported = 0;
  let totalSkipped = 0;

  for (const sheetName of workbook.SheetNames) {
    const serviceInfo = SERVICE_MAP[sheetName];
    if (!serviceInfo) {
      console.log(`⚠️  Skipping unknown sheet: ${sheetName}`);
      continue;
    }

    const [serviceRows] = await connection.query(
      'SELECT id FROM vas_service_types WHERE code = ?',
      [serviceInfo.code]
    );
    const serviceTypeId = serviceRows[0]?.id;
    if (!serviceTypeId) continue;

    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Determine revenue period from sheet header
    let revenuePeriod = '2026-05'; // Default May 2026
    const headerRow = data[0] || [];
    const headerStr = headerRow.join(' ').toLowerCase();
    if (headerStr.includes('august')) revenuePeriod = '2024-08';
    else if (headerStr.includes('jan')) revenuePeriod = '2025-01';
    else if (headerStr.includes('may')) revenuePeriod = '2026-05';

    let sheetRevenue = 0;
    let partnerCount = 0;

    // Parse based on sheet type
    for (let i = 3; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      // Extract partner info
      let serviceId = '';
      let partnerName = '';
      let totalRevenue = 0;
      let ethioShare = 0;
      let partnerShare = 0;
      let maShare = 0;
      let sharingModel = '';
      let status = 'validated';

      // Different sheets have different column layouts
      if (sheetName.includes('Premium SMS MT') || sheetName === 'Premium SMS MT ') {
        serviceId = String(row[0] || '');
        const codeOrName = row[1];
        partnerName = typeof codeOrName === 'number' ? String(row[2] || '') : String(codeOrName || row[2] || '');
        totalRevenue = parseFloat(row[4]) || 0;
        ethioShare = parseFloat(row[5]) || 0;
        maShare = parseFloat(row[6]) || 0;
        partnerShare = parseFloat(row[7]) || 0;
        sharingModel = String(row[8] || '');
        if (String(row[row.length - 1] || '').includes('Validated')) status = 'validated';
      } else if (sheetName.includes('API with MA')) {
        serviceId = String(row[0] || '');
        partnerName = String(row[1] || '');
        totalRevenue = parseFloat(row[3]) || 0;
        ethioShare = parseFloat(row[4]) || 0;
        maShare = parseFloat(row[5]) || 0;
        partnerShare = parseFloat(row[6]) || 0;
        sharingModel = String(row[7] || '');
        if (String(row[row.length - 1] || '').includes('Validated')) status = 'validated';
      } else if (sheetName.includes('Voice_Premium')) {
        serviceId = String(row[0] || '');
        partnerName = String(row[1] || '');
        totalRevenue = parseFloat(row[3]) || 0;
        ethioShare = parseFloat(row[4]) || 0;
        partnerShare = parseFloat(row[5]) || 0;
        sharingModel = String(row[6] || '');
        if (String(row[row.length - 1] || '').includes('Validated')) status = 'validated';
      } else if (sheetName === 'SMS-MO_Premium') {
        serviceId = String(row[0] || '');
        partnerName = String(row[1] || '');
        totalRevenue = parseFloat(row[3]) || 0;
        ethioShare = parseFloat(row[4]) || 0;
        partnerShare = parseFloat(row[5]) || 0;
        sharingModel = String(row[6] || '');
        if (String(row[row.length - 1] || '').includes('Validated')) status = 'validated';
      } else if (sheetName === 'National Lottery ') {
        serviceId = String(row[0] || '');
        partnerName = String(row[1] || '');
        totalRevenue = parseFloat(row[2]) || parseFloat(row[3]) || 0;
        ethioShare = parseFloat(row[3]) || parseFloat(row[4]) || 0;
        partnerShare = parseFloat(row[4]) || parseFloat(row[5]) || 0;
        if (String(row[row.length - 1] || '').includes('Validated')) status = 'validated';
      } else if (sheetName === 'CRBT-Partners') {
        serviceId = String(row[0] || '');
        partnerName = String(row[1] || '');
        totalRevenue = parseFloat(row[4]) || (parseFloat(row[2] || 0) + parseFloat(row[3] || 0));
        partnerShare = parseFloat(row[5]) || 0;
        if (String(row[row.length - 1] || '').includes('Validated')) status = 'validated';
      } else if (sheetName === 'Voice') {
        serviceId = String(row[0] || '');
        partnerName = ''; // Voice sheet doesn't have partner names
        totalRevenue = parseFloat(row[1]) || 0;
        ethioShare = parseFloat(row[2]) || 0;
        partnerShare = parseFloat(row[3]) || 0;
        sharingModel = String(row[row.length - 1] || '');
      } else {
        // Generic fallback
        serviceId = String(row[0] || '');
        partnerName = String(row[1] || '');
        for (let j = 2; j < Math.min(row.length, 8); j++) {
          const val = parseFloat(row[j]);
          if (val && val > 100) {
            totalRevenue = val;
            break;
          }
        }
      }

      // Skip empty or TOTAL rows
      if (!partnerName && !totalRevenue) continue;
      if (partnerName.toUpperCase() === 'TOTAL') continue;
      if (totalRevenue <= 0) continue;

      partnerName = partnerName.trim().substring(0, 500);
      if (!partnerName) partnerName = 'Unknown Partner';

      try {
        await connection.query(
          `INSERT INTO partner_revenue 
           (service_type_id, service_id, partner_name, total_revenue, ethio_share, partner_share, ma_share, revenue_sharing_model, status, import_batch_id, revenue_period) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [serviceTypeId, serviceId, partnerName, totalRevenue, ethioShare || null, partnerShare || null, maShare || null, sharingModel || null, status, batchId, revenuePeriod]
        );
        sheetRevenue += totalRevenue;
        partnerCount++;
        totalImported++;
      } catch (err) {
        console.warn(`  Skip: ${partnerName} - ${err.message}`);
        totalSkipped++;
      }
    }

    // Insert summary
    if (partnerCount > 0) {
      await connection.query(
        `INSERT INTO service_revenue_summary (service_type_id, revenue_period, total_revenue, partner_count, created_at) 
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE total_revenue = VALUES(total_revenue), partner_count = VALUES(partner_count)`,
        [serviceTypeId, revenuePeriod, sheetRevenue, partnerCount]
      );
    }

    console.log(`✅ ${serviceInfo.name}: ETB ${sheetRevenue.toLocaleString('en-US', {minimumFractionDigits: 2})} (${partnerCount} partners, period: ${revenuePeriod})`);
  }

  console.log(`\n🎉 Import complete!`);
  console.log(`   Total imported: ${totalImported} partner records`);
  console.log(`   Total skipped: ${totalSkipped}`);

  // Print grand total
  const [totals] = await connection.query(
    `SELECT revenue_period, SUM(total_revenue) as grand_total, SUM(partner_count) as total_partners 
     FROM service_revenue_summary GROUP BY revenue_period`
  );
  console.log('\n=== Revenue Summary by Period ===');
  totals.forEach(t => {
    console.log(`   ${t.revenue_period}: ETB ${parseFloat(t.grand_total).toLocaleString('en-US', {minimumFractionDigits: 2})} (${t.total_partners} partners)`);
  });

  await connection.end();
  process.exit(0);
}

setup().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
