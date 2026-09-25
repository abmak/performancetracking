const path = require('path');

/**
 * Central .env loader.
 *
 * Local development  → backend/.env
 * Production deploys → backend/.env.production
 *
 * Selection order:
 *   1. ENV_FILE  — explicit override (e.g. `ENV_FILE=.env.production pm2 start ...`)
 *   2. NODE_ENV=production → .env.production
 *   3. everything else → .env
 */
const envFile = process.env.ENV_FILE || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env');
const result = require('dotenv').config({ path: path.resolve(__dirname, '..', envFile) });

if (result.error && result.error.code !== 'ENOENT') {
  console.warn(`env: could not load ${envFile}: ${result.error.message}`);
}
