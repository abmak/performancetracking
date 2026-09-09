/**
 * One-time migration: Add performance indexes to the revenue tables.
 * Run with: node src/config/addIndexes.js
 *
 * Uses IF NOT EXISTS so it's safe to re-run.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  const indexes = [
    // partner_revenue — the primary source for all dashboard/partner queries
    {
      table: 'partner_revenue',
      name: 'idx_pr_revenue_month',
      sql: 'ALTER TABLE partner_revenue ADD INDEX idx_pr_revenue_month (revenue_month)',
    },
    {
      table: 'partner_revenue',
      name: 'idx_pr_partner_name',
      sql: 'ALTER TABLE partner_revenue ADD INDEX idx_pr_partner_name (partner_name(100))',
    },
    {
      table: 'partner_revenue',
      name: 'idx_pr_service_name',
      sql: 'ALTER TABLE partner_revenue ADD INDEX idx_pr_service_name (service_name(100))',
    },
    // actual_revenue — joined in all UNION ALL queries
    {
      table: 'actual_revenue',
      name: 'idx_ar_revenue_month',
      sql: 'ALTER TABLE actual_revenue ADD INDEX idx_ar_revenue_month (revenue_month)',
    },
    {
      table: 'actual_revenue',
      name: 'idx_ar_service_id',
      sql: 'ALTER TABLE actual_revenue ADD INDEX idx_ar_service_id (service_id)',
    },
    // revenue_targets — used in achievement calculations
    {
      table: 'revenue_targets',
      name: 'idx_rt_dates',
      sql: 'ALTER TABLE revenue_targets ADD INDEX idx_rt_dates (target_start_date, target_end_date)',
    },
    {
      table: 'revenue_targets',
      name: 'idx_rt_service_name',
      sql: 'ALTER TABLE revenue_targets ADD INDEX idx_rt_service_name (service_name(100))',
    },
  ];

  let added = 0;
  let skipped = 0;

  for (const idx of indexes) {
    try {
      // Check if index already exists
      const [rows] = await conn.execute(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [process.env.DB_NAME, idx.table, idx.name]
      );
      if (rows.length > 0) {
        console.log(`⏭  Skipped (already exists): ${idx.table}.${idx.name}`);
        skipped++;
        continue;
      }
      await conn.execute(idx.sql);
      console.log(`✅ Added index: ${idx.table}.${idx.name}`);
      added++;
    } catch (err) {
      console.error(`❌ Failed ${idx.table}.${idx.name}: ${err.message}`);
    }
  }

  console.log(`\n🏁 Done — ${added} added, ${skipped} skipped`);
  await conn.end();
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
