/**
 * ensureAdminPermissions — grants ALL permissions to the Admin role (GLOBAL scope).
 *
 * Run once after the permission-based access changes so the master admin
 * can still access every feature.  Safe to re-run (uses INSERT IGNORE).
 *
 *   node src/config/ensureAdminPermissions.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  console.log('✅ Connected to database');

  // Find the Admin role
  const [roles] = await conn.query("SELECT id FROM roles WHERE name = 'Admin' LIMIT 1");
  if (roles.length === 0) {
    console.error('❌ No role named "Admin" found. Please create one first.');
    process.exit(1);
  }
  const adminRoleId = roles[0].id;
  console.log(`✅ Found Admin role (id=${adminRoleId})`);

  // Count current permissions
  const [before] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM role_permissions WHERE role_id = ?',
    [adminRoleId]
  );
  console.log(`   Current permissions: ${before[0].cnt}`);

  // Grant every permission to the Admin role
  const [result] = await conn.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT ?, p.id FROM permissions p
  `, [adminRoleId]);

  console.log(`✅ Granted ${result.affectedRows} new permission(s) to Admin role`);

  // Final count
  const [after] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM role_permissions WHERE role_id = ?',
    [adminRoleId]
  );
  console.log(`   Total permissions now: ${after[0].cnt}`);

  await conn.end();
  console.log('\n🎉 Done! The Admin role now has all permissions.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
