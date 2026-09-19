const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  console.log('✅ Connected to database');

  // 1. Create sections.swap permission if it doesn't exist
  const [existing] = await connection.query(
    "SELECT id FROM permissions WHERE name = 'sections.swap'"
  );

  if (existing.length === 0) {
    await connection.query(
      "INSERT INTO permissions (name, description, module, action) VALUES (?, ?, ?, ?)",
      ['sections.swap', 'Switch between VAS and Indirect Channel sections', 'sections', 'swap']
    );
    console.log('✅ Created permission: sections.swap');
  } else {
    console.log('ℹ️  Permission sections.swap already exists');
  }

  // 2. Create user_sections table for section-specific role assignments
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_sections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      section VARCHAR(50) NOT NULL COMMENT 'VAS or INDIRECT_CHANNEL',
      role_id INT NOT NULL COMMENT 'Role to use in this section',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_section (user_id, section),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    )
  `);
  console.log('✅ user_sections table created/verified');

  // 3. Create role_section_access table for section swap permissions
  await connection.query(`
    CREATE TABLE IF NOT EXISTS role_section_access (
      id INT AUTO_INCREMENT PRIMARY KEY,
      role_id INT NOT NULL,
      section VARCHAR(50) NOT NULL COMMENT 'VAS or INDIRECT_CHANNEL',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_role_section (role_id, section),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    )
  `);
  console.log('✅ role_section_access table created/verified');

  // 4. Get the sections.swap permission ID
  const [permRows] = await connection.query(
    "SELECT id FROM permissions WHERE name = 'sections.swap'"
  );
  const permId = permRows[0].id;

  // 5. Auto-assign to every master admin role (roles.scope = GLOBAL)
  let masterRoles = [];
  try {
    masterRoles = (await connection.query("SELECT id FROM roles WHERE scope = 'GLOBAL'"))[0];
  } catch (err) {
    // roles.scope is added by addScopeColumns.js — fall back to the legacy name
    console.log('ℹ️  roles.scope not present yet; falling back to the Admin role name');
    masterRoles = (await connection.query("SELECT id FROM roles WHERE name = 'Admin'"))[0];
  }

  if (masterRoles.length > 0) {
    for (const role of masterRoles) {
      const [alreadyAssigned] = await connection.query(
        'SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?',
        [role.id, permId]
      );
      if (alreadyAssigned.length === 0) {
        await connection.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
          [role.id, permId]
        );
        console.log(`✅ Assigned sections.swap to master admin role ${role.id}`);
      } else {
        console.log(`ℹ️  Role ${role.id} already has sections.swap`);
      }

      // 6. Grant full section access (both VAS and IC)
      const [adminAccess] = await connection.query(
        'SELECT id FROM role_section_access WHERE role_id = ?',
        [role.id]
      );
      if (adminAccess.length === 0) {
        await connection.query(
          'INSERT INTO role_section_access (role_id, section) VALUES (?, ?), (?, ?)',
          [role.id, 'VAS', role.id, 'INDIRECT_CHANNEL']
        );
        console.log(`✅ Granted role ${role.id} access to both VAS and INDIRECT_CHANNEL`);
      } else {
        console.log(`ℹ️  Role ${role.id} already has section access`);
      }
    }
  }

  await connection.end();
  console.log('\n🎉 Migration complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
