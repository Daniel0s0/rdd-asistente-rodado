// scripts/db-status.ts — Estado de migraciones: aplicadas (schema_migrations) vs locales (db/migrations/)
// Uso: npm run db:status
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  const migrationsDir = path.join(process.cwd(), 'db', 'migrations');
  const local = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();

  console.log(`Migraciones locales (${local.length}): ${local.join(', ')}\n`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY — no se puede consultar la DB.');
    process.exit(1);
  }

  const db = createClient(url, key);
  const { data, error } = await db.from('schema_migrations').select('version, applied_at');

  if (error) {
    console.error(`No se pudo leer schema_migrations: ${error.message}`);
    console.error(
      'Si la tabla no existe, aplica db/migrations/0001_baseline.sql en el SQL Editor de Supabase.'
    );
    process.exit(1);
  }

  const applied = new Set((data ?? []).map((r) => r.version as string));

  for (const m of local) {
    console.log(applied.has(m) ? `  ✅ ${m} (aplicada)` : `  ⏳ ${m} (PENDIENTE — aplicar en SQL Editor)`);
  }

  const unknown = [...applied].filter((v) => !local.includes(v));
  if (unknown.length > 0) {
    console.warn(`\n⚠️  Aplicadas en DB pero sin archivo local: ${unknown.join(', ')}`);
  }

  const pending = local.filter((m) => !applied.has(m));
  process.exit(pending.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('db-status falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
