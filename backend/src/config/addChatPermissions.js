/**
 * addChatPermissions — ensures chat and messages permissions exist in the
 * permissions table so they appear in the role editor.
 *
 *   node src/config/addChatPermissions.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const PERMISSIONS = [
  // ── VAS Section ──────────────────────────────────────────────────────
  // Chat (direct messages + groups)
  { name: 'chat.view',         description: 'Access the Chat feature',            module: 'chat',     action: 'view',         section: 'VAS' },
  { name: 'chat.send',         description: 'Send direct and group messages',     module: 'chat',     action: 'send',         section: 'VAS' },
  { name: 'chat.create_group', description: 'Create chat groups',                 module: 'chat',     action: 'create_group', section: 'VAS' },
  { name: 'chat.delete_group', description: 'Delete chat groups',                 module: 'chat',     action: 'delete_group', section: 'VAS' },

  // Messages (SMS)
  { name: 'messages.view',     description: 'Access the Messages (SMS) feature', module: 'messages', action: 'view',         section: 'VAS' },
  { name: 'messages.send',     description: 'Send SMS messages',                 module: 'messages', action: 'send',         section: 'VAS' },

  // ── Indirect Channel Section ─────────────────────────────────────────
  // Chat (direct messages + groups)
  { name: 'channel_chat.view',         description: 'Access the Chat feature',            module: 'channel_chat',     action: 'view',         section: 'INDIRECT_CHANNEL' },
  { name: 'channel_chat.send',         description: 'Send direct and group messages',     module: 'channel_chat',     action: 'send',         section: 'INDIRECT_CHANNEL' },
  { name: 'channel_chat.create_group', description: 'Create chat groups',                 module: 'channel_chat',     action: 'create_group', section: 'INDIRECT_CHANNEL' },
  { name: 'channel_chat.delete_group', description: 'Delete chat groups',                 module: 'channel_chat',     action: 'delete_group', section: 'INDIRECT_CHANNEL' },

  // Messages (SMS)
  { name: 'channel_messages.view',     description: 'Access the Messages (SMS) feature', module: 'channel_messages', action: 'view',         section: 'INDIRECT_CHANNEL' },
  { name: 'channel_messages.send',     description: 'Send SMS messages',                 module: 'channel_messages', action: 'send',         section: 'INDIRECT_CHANNEL' },
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
