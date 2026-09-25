/**
 * addChannelEditPermissions — ensures the Indirect Channel edit/delete
 * permissions exist in the permissions table so they appear in the role editor.
 *
 * Roles holding these permissions can edit and delete registered channel data
 * (the Entity Registry on the Channel Dashboard and the record tables on
 * Channel Reports).
 *
 *   node src/config/addChannelEditPermissions.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const PERMISSIONS = [
  { name: 'channel_entities.edit',   description: 'Edit registered channel data (dashboard registry and reports)', module: 'channel_entities',   action: 'edit',   section: 'INDIRECT_CHANNEL' },
  { name: 'channel_entities.delete', description: 'Delete registered channel data (dashboard registry and reports)', module: 'channel_entities',   action: 'delete', section: 'INDIRECT_CHANNEL' },
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  console.log('✅ Connected to database');

  let created = 0;
  for (const p of PERMISSIONS) {
    const [existing] = await conn.query('SELECT id FROM permissions WHERE name = ?', [p.name]);
    if (existing.length === 0) {
      await conn.query(
        'INSERT INTO permissions (name, description, module, action, section) VALUES (?, ?, ?, ?, ?)',
        [p.name, p.description, p.module, p.action, p.section]
      );
      console.log(`✅ Created permission: ${p.name} (section: ${p.section})`);
      created++;
    } else {
      // If it exists but section is wrong, fix it
      await conn.query(
        'UPDATE permissions SET section = ? WHERE name = ? AND (section IS NULL OR section != ?)',
        [p.section, p.name, p.section]
      );
      console.log(`ℹ️  Permission ${p.name} already exists (ensured section: ${p.section})`);
    }
  }

  await conn.end();
  console.log(`\n🎉 Done! Created ${created} new permission(s).`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
