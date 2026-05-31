#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔐 Using:', supabaseKey.substring(0, 30) + '...');
console.log('📍 URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

const estadoToState = {
  'Pendiente 01': 'activo',
  'Pendiente 02': 'activo',
  'Pendiente 03': 'activo',
  'Pendiente 04': 'activo',
  'Pendiente 05': 'activo',
  'Pendiente 23': 'activo',
  'PENDIENTE SENTENCIA': 'activo',
  'COBRANZA JUDICIAL': 'activo',
  'EMBARGO': 'activo',
  'REMATE': 'activo',
  'CHEQUESITO': 'activo',
  'Activo': 'activo',
  'Rechaza Dda': 'desistido',
  'RECHAZA DEMANDA': 'desistido',
  'Incobrable - Desistimiento': 'desistido',
  'Desistimiento - Pagado': 'desistido',
  'Pagado y Liquidado': 'archivado',
  'Pagado y Liquidado P': 'archivado',
  'Caducada': 'caducado',
  'Caducada - Pagada': 'caducado',
  'Acuerdo': 'acuerdo',
  'C.A. TABLA 1812-2025': 'activo',
  'C.A. TABLA 4771-2025': 'activo',
  'C.A. TABLA 220-2026': 'activo',
  'C.A. TABLA 1029-2026': 'activo',
  'CONFECCIONADA - INGRESO': 'activo',
  'COMPARENDO DE CONCILIACION': 'activo',
  'DESISTIMIENTO': 'desistido',
  'N/A': 'activo',
};

async function load() {
  console.log('📂 Reading historical cases...\n');

  const filePath = path.join(process.cwd(), 'b/historicas.xlsx');
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws);

  console.log(`✅ Read ${data.length} cases\n`);

  const usedIds = new Set();

  const rows = data.map((row, idx) => {
    // Generate unique causa_id: use RIT if valid (format: X-number-number), else generate
    let causaId = row.Rit?.trim?.();
    const ritIsValid = causaId && /^[A-Z]+-\d+-\d{4}/.test(causaId);

    if (!ritIsValid) {
      // Create unique ID from available data: HIST-{CI}-{idx}
      const ci = (row.CI || 'UNK').replace(/[^0-9A-Z]/g, '').slice(0, 10);
      causaId = `HIST-${ci}-${idx}`;
    }

    // Handle duplicates within the same file
    if (usedIds.has(causaId)) {
      causaId = `${causaId}-${idx}`;
    }
    usedIds.add(causaId);

    const caseState = estadoToState[row.Estado] || 'activo';

    let createdAt = new Date();
    if (row.Fecha2 && typeof row.Fecha2 === 'number' && row.Fecha2 > 0) {
      createdAt = new Date((row.Fecha2 - 25569) * 86400 * 1000);
    }

    return {
      id: uuidv4(),
      causa_id: causaId,
      cliente_nombre: row.Nombre,
      demandado: null,
      tribunal: row.Tribunal,
      rit: row.Rit,
      etapa: 'cobranza',
      case_state: caseState,
      ingreso_honorarios: Math.round(row.Recupero) || 0,
      pagos_pendientes: 0,
      created_at: createdAt.toISOString(),
      closed_at: null,
      metadata: {
        ci: row.CI,
        fee_percentage: row['%'],
        imported_from: 'historicas.xlsx',
        import_date: new Date().toISOString(),
      },
    };
  });

  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('conversations')
      .upsert(batch, { onConflict: 'causa_id' });

    if (error) {
      console.error(`❌ Batch ${i / batchSize + 1} error:`, error);
      process.exit(1);
    }

    inserted += batch.length;
    console.log(`✅ Inserted ${inserted}/${rows.length}`);
  }

  console.log(`\n🎉 Success! Loaded ${inserted} cases to Supabase`);
}

load().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
