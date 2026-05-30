import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load .env.local (development) or .env (default)
// Must be the first module imported in index.ts to ensure process.env is populated
// before any other module tries to read env vars

const root = path.resolve(__dirname, '..', '..');
const envLocal = path.join(root, '.env.local');
const envDefault = path.join(root, '.env');

if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else if (fs.existsSync(envDefault)) {
  dotenv.config({ path: envDefault });
}
