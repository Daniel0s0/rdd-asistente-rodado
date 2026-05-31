import 'dotenv/config';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Map Excel estado values to RDD case states
const estadoToState: Record<string, string> = {
  // Activos (en proceso)
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

  // Desistidos (rechazados)
  'Rechaza Dda': 'desistido',
  'RECHAZA DEMANDA': 'desistido',
  'Incobrable - Desistimiento': 'desistido',
  'Desistimiento - Pagado': 'desistido',

  // Archivados (completados)
  'Pagado y Liquidado': 'archivado',
  'Pagado y Liquidado P': 'archivado',

  // Caducados
  'Caducada': 'caducado',
  'Caducada - Pagada': 'caducado',

  // Acuerdos
  'Acuerdo': 'acuerdo',

  // Otros estados C.A., etc.
  'C.A. TABLA 1812-2025': 'activo',
  'C.A. TABLA 4771-2025': 'activo',
  'C.A. TABLA 220-2026': 'activo',
  'C.A. TABLA 1029-2026': 'activo',

  'CONFECCIONADA - INGRESO': 'activo',
  'COMPARENDO DE CONCILIACION': 'activo',
  'DESISTIMIENTO': 'desistido',
  'N/A': 'activo',
};

interface ExcelRow {
  CI: string;
  Nombre: string;
  Rit: string;
  Tribunal: string;
  Recupero: number;
  '%': number;
  Estado: string;
  Fecha2: number | null;
}

async function seedHistoricas() {
  console.log('📂 Leyendo archivo de causas históricas...');

  const filePath = path.join(process.cwd(), 'b/historicas.xlsx');
  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);

  console.log(`✅ Leído ${data.length} causas del Excel`);

  const conversationsToInsert = data.map((row) => {
    const causaId = row.Rit || `HIST-${uuidv4().slice(0, 8)}`;
    const caseState = estadoToState[row.Estado] || 'activo';

    // Excel Fecha2 might be numeric (Excel serial date) or 0 (null)
    let createdAt = new Date();
    if (row.Fecha2 && typeof row.Fecha2 === 'number' && row.Fecha2 > 0) {
      // Excel date serial: days since 1900-01-01
      createdAt = new Date((row.Fecha2 - 25569) * 86400 * 1000);
    }

    return {
      id: uuidv4(),
      causa_id: causaId,
      cliente_nombre: row.Nombre,
      demandado: null, // Not in historical data
      tribunal: row.Tribunal,
      rit: row.Rit,
      etapa: 'cobranza', // Historical cases assumed to be in collection phase
      case_state: caseState,
      ingreso_honorarios: Math.round(row.Recupero) || 0,
      pagos_pendientes: 0,
      created_at: createdAt.toISOString(),
      closed_at: null, // Not in historical data
      metadata: {
        ci: row.CI,
        fee_percentage: row['%'],
        imported_from: 'historicas.xlsx',
        import_date: new Date().toISOString(),
      },
    };
  });

  console.log(`\n📊 Preparado para insertar ${conversationsToInsert.length} causas...`);
  console.log('Ejemplos:');
  console.log(JSON.stringify(conversationsToInsert.slice(0, 2), null, 2));

  // Insert in batches
  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < conversationsToInsert.length; i += batchSize) {
    const batch = conversationsToInsert.slice(i, i + batchSize);
    const { error } = await supabase.from('conversations').insert(batch);

    if (error) {
      console.error(`❌ Error en batch ${i / batchSize + 1}:`, error);
      process.exit(1);
    }

    inserted += batch.length;
    console.log(`✅ Insertadas ${inserted}/${conversationsToInsert.length} causas`);
  }

  console.log(`\n🎉 ¡Importación completada! ${inserted} causas cargadas a Supabase`);
}

seedHistoricas().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
