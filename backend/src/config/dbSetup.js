const mysql = require('mysql2/promise');
require('dotenv').config();

const createTablesSQL = `
-- Create Database if not exists
CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME};
USE ${process.env.DB_NAME};

-- VAS Services table
CREATE TABLE IF NOT EXISTS vas_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  category ENUM('messaging', 'content', 'entertainment', 'utility', 'enterprise', 'other') DEFAULT 'other',
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Revenue Targets table
CREATE TABLE IF NOT EXISTS revenue_targets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  service_id INT NOT NULL,
  target_amount DECIMAL(15, 2) NOT NULL,
  period_type ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly') NOT NULL,
  period_value VARCHAR(20) NOT NULL,
  fiscal_year YEAR NOT NULL,
  assigned_by VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (service_id) REFERENCES vas_services(id) ON DELETE CASCADE
);

-- Actual Revenue Data table
CREATE TABLE IF NOT EXISTS actual_revenue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  service_id INT NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  revenue_date DATE NOT NULL,
  source ENUM('manual', 'excel_import') DEFAULT 'manual',
  import_batch_id VARCHAR(36),
  entered_by VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (service_id) REFERENCES vas_services(id) ON DELETE CASCADE
);

-- Import Batches table (for tracking Excel imports)
CREATE TABLE IF NOT EXISTS import_batches (
  id VARCHAR(36) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  total_records INT DEFAULT 0,
  successful_records INT DEFAULT 0,
  failed_records INT DEFAULT 0,
  imported_by VARCHAR(100),
  status ENUM('processing', 'completed', 'failed') DEFAULT 'processing',
  error_log TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Trail table
CREATE TABLE IF NOT EXISTS audit_trail (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT,
  description TEXT,
  user_name VARCHAR(100),
  old_value JSON,
  new_value JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dashboard KPI snapshots (for historical tracking)
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  total_target DECIMAL(15, 2),
  total_actual DECIMAL(15, 2),
  achievement_pct DECIMAL(5, 2),
  active_services INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_revenue_date ON actual_revenue(revenue_date);
CREATE INDEX idx_revenue_service ON actual_revenue(service_id);
CREATE INDEX idx_target_service ON revenue_targets(service_id);
CREATE INDEX idx_target_period ON revenue_targets(period_type, period_value);
CREATE INDEX idx_audit_entity ON audit_trail(entity_type, entity_id);
CREATE INDEX idx_audit_date ON audit_trail(created_at);
`;

const seedDataSQL = `
USE ${process.env.DB_NAME};

-- Seed Sample VAS Services
INSERT IGNORE INTO vas_services (id, name, code, description, category, status) VALUES
(1, 'Caller Ring Back Tone', 'CRBT', 'Custom ring back tones for callers', 'entertainment', 'active'),
(2, 'Mobile TV', 'MTV', 'Live and on-demand TV streaming service', 'content', 'active'),
(3, 'SMS Bundles', 'SMSB', 'Package SMS bundles for subscribers', 'messaging', 'active'),
(4, 'Data Bundles', 'DAB', 'Internet data packages', 'utility', 'active'),
(5, 'IVR Services', 'IVR', 'Interactive Voice Response services', 'utility', 'active'),
(6, 'Mobile Money Alerts', 'MMA', 'Transaction alerts for mobile money', 'enterprise', 'active'),
(7, 'Missed Call Alert', 'MCA', 'Notification for missed calls', 'utility', 'active'),
(8, 'Content on Demand', 'COD', 'Downloadable content platform', 'content', 'active'),
(9, 'Enterprise SMS', 'ESMS', 'Bulk SMS for enterprises', 'enterprise', 'active'),
(10, 'WAKILTU Gaming', 'WKG', 'Mobile gaming platform', 'entertainment', 'active');

-- Seed Sample Revenue Targets (Monthly for August 2025)
INSERT IGNORE INTO revenue_targets (id, service_id, target_amount, period_type, period_value, fiscal_year, assigned_by, notes) VALUES
(1, 1, 2500000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for CRBT'),
(2, 2, 1800000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for Mobile TV'),
(3, 3, 3200000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for SMS Bundles'),
(4, 4, 5500000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for Data Bundles'),
(5, 5, 800000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for IVR'),
(6, 6, 1200000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for MMA'),
(7, 7, 600000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for MCA'),
(8, 8, 1500000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for COD'),
(9, 9, 4000000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for Enterprise SMS'),
(10, 10, 900000.00, 'monthly', '2025-08', 2025, 'VAS Director', 'August target for WAKILTU Gaming');

-- Seed Quarterly Targets
INSERT IGNORE INTO revenue_targets (id, service_id, target_amount, period_type, period_value, fiscal_year, assigned_by) VALUES
(11, 1, 7500000.00, 'quarterly', 'Q3-2025', 2025, 'VAS Director'),
(12, 2, 5400000.00, 'quarterly', 'Q3-2025', 2025, 'VAS Director'),
(13, 3, 9600000.00, 'quarterly', 'Q3-2025', 2025, 'VAS Director'),
(14, 4, 16500000.00, 'quarterly', 'Q3-2025', 2025, 'VAS Director'),
(15, 5, 2400000.00, 'quarterly', 'Q3-2025', 2025, 'VAS Director');

-- Seed Actual Revenue Data (August 2025)
INSERT IGNORE INTO actual_revenue (service_id, amount, revenue_date, source, entered_by, notes) VALUES
(1, 450000.00, '2025-08-01', 'manual', 'Admin', 'Day 1 revenue'),
(1, 520000.00, '2025-08-02', 'manual', 'Admin', 'Day 2 revenue'),
(1, 380000.00, '2025-08-03', 'manual', 'Admin', 'Day 3 revenue'),
(1, 610000.00, '2025-08-04', 'manual', 'Admin', 'Day 4 revenue'),
(1, 290000.00, '2025-08-05', 'manual', 'Admin', 'Day 5 revenue'),
(2, 320000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(2, 410000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(2, 380000.00, '2025-08-03', 'manual', 'Admin', 'Day 3'),
(3, 680000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(3, 720000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(3, 590000.00, '2025-08-03', 'manual', 'Admin', 'Day 3'),
(4, 1100000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(4, 950000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(4, 1250000.00, '2025-08-03', 'manual', 'Admin', 'Day 3'),
(5, 150000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(5, 180000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(6, 280000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(6, 310000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(7, 120000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(7, 140000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(8, 340000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(8, 290000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(9, 850000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(9, 920000.00, '2025-08-02', 'manual', 'Admin', 'Day 2'),
(10, 180000.00, '2025-08-01', 'manual', 'Admin', 'Day 1'),
(10, 210000.00, '2025-08-02', 'manual', 'Admin', 'Day 2');

-- Seed Audit Trail
INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES
('create', 'service', 1, 'Created service: Caller Ring Back Tone', 'System'),
('create', 'service', 2, 'Created service: Mobile TV', 'System'),
('create', 'service', 3, 'Created service: SMS Bundles', 'System'),
('create', 'service', 4, 'Created service: Data Bundles', 'System'),
('create', 'target', 1, 'Set monthly target for CRBT: 2,500,000 ETB', 'VAS Director'),
('create', 'revenue', 1, 'Manual revenue entry for CRBT', 'Admin');
`;

async function setup() {
  try {
    // First connect without database to create it
    const tempConnection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 3306,
    });

    console.log('✅ Connected to MySQL server');

    // Create database
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
    console.log(`✅ Database '${process.env.DB_NAME}' created/verified`);

    await tempConnection.end();

    // Connect to the database
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      multipleStatements: true,
    });

    console.log('✅ Connected to database');

    // Execute table creation using query() (not execute) for multi-statement support
    const statements = createTablesSQL.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        await connection.query(stmt);
      }
    }
    console.log('✅ Tables created successfully');

    // Seed data using query()
    const seedStatements = seedDataSQL.split(';').filter(s => s.trim());
    for (const stmt of seedStatements) {
      if (stmt.trim()) {
        try {
          await connection.query(stmt);
        } catch (e) {
          // Skip duplicate key errors for seeding
          if (e.code !== 'ER_DUP_ENTRY') {
            console.warn('Seed warning:', e.message);
          }
        }
      }
    }
    console.log('✅ Sample data seeded successfully');

    await connection.end();
    console.log('\n🎉 Database setup complete!');
    console.log(`   Database: ${process.env.DB_NAME}`);
    console.log('   Tables: vas_services, revenue_targets, actual_revenue, import_batches, audit_trail, kpi_snapshots');
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setup();
