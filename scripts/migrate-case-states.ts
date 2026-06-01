// scripts/migrate-case-states.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load .env
dotenv.config();

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  return createClient(url, key);
}

// Mapping de valores incorrectos → correctos
const STATE_MIGRATION: Record<string, { case_state: string; motivo_cierre: string | null }> = {
  activo:    { case_state: 'activa',  motivo_cierre: null },
  acuerdo:   { case_state: 'activa',  motivo_cierre: null },    // tiene acuerdos en tabla acuerdos
  archivado: { case_state: 'cerrada', motivo_cierre: 'caducada' },
  desistido: { case_state: 'cerrada', motivo_cierre: 'desistimiento' },
  caducado:  { case_state: 'cerrada', motivo_cierre: 'caducada' },
  pagado:    { case_state: 'cerrada', motivo_cierre: 'pago_total' },
};

async function migrateCaseStates() {
  const db = getDb();

  console.log('Iniciando migración de case_state...');

  // 3. Leer todas las conversaciones (con tipado any para evitar errores de Supabase client)
  const { data: conversations, error } = await (db as any)
    .from('conversations')
    .select('id, case_state, causa_id');

  if (error) throw error;

  if (!conversations) {
    console.log('Encontradas 0 causas para migrar');
    return;
  }

  console.log(`Encontradas ${conversations.length} causas para migrar`);

  // 4. Migrar cada una
  let migrated = 0;
  let skipped = 0;

  for (const conv of conversations) {
    const mapping = STATE_MIGRATION[conv.case_state];

    if (!mapping) {
      // Ya está en el nuevo formato
      if (conv.case_state === 'activa' || conv.case_state === 'cerrada') {
        skipped++;
        continue;
      }
      console.warn(`  UNKNOWN state: causa ${conv.causa_id} tiene case_state="${conv.case_state}"`);
      skipped++;
      continue;
    }

    const { error: updateError } = await (db as any)
      .from('conversations')
      .update({
        case_state: mapping.case_state,
        motivo_cierre: mapping.motivo_cierre,
      })
      .eq('id', conv.id);

    if (updateError) {
      console.error(`  ERROR en causa ${conv.causa_id}: ${updateError.message}`);
    } else {
      console.log(`  ✅ ${conv.causa_id}: ${conv.case_state} → ${mapping.case_state}${mapping.motivo_cierre ? ` (${mapping.motivo_cierre})` : ''}`);
      migrated++;
    }
  }

  console.log(`\nMigración completa: ${migrated} migradas, ${skipped} ya correctas`);
}

migrateCaseStates().catch(console.error);
