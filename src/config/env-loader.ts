/* eslint-disable no-console -- este módulo corre ANTES de cargar .env;
   el logger (Pino) depende de getEnv() y no puede usarse aquí */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load .env.local (development) or .env (default)
// Must be the first module imported in index.ts to ensure process.env is populated
// before any other module tries to read env vars

// Use process.cwd() instead of __dirname for tsx compatibility
const root = process.cwd();
const envLocal = path.join(root, '.env.local');
const envDefault = path.join(root, '.env');

if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
  console.log(`[env-loader] Loaded .env.local from ${envLocal}`);
} else if (fs.existsSync(envDefault)) {
  dotenv.config({ path: envDefault });
  console.log(`[env-loader] Loaded .env from ${envDefault}`);
} else {
  console.log(`[env-loader] No .env files found in ${root}`);
}
