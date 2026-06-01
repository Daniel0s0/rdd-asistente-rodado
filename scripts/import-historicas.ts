/**
 * Import historical cases from historicas.xlsx into Supabase
 * Usage: npx dotenv -e .env -- tsx scripts/import-historicas.ts
 *
 * Mapeo Excel → Supabase:
 * - Rit (C) → causa_id + rit
 * - Nombre (B) → cliente_nombre
 * - CI (A) → cliente_rut
 * - Tribunal (D) → tribunal
 * - Estado (M) → case_state
 * - Recupero (F) > 0 → registros tipo=cobranza
 * - Honorario (H) > 0 → registros tipo=honorarios
 * - Gastos (N) > 0 → registros tipo=gasto
 * - Fecha2 (O) → fecha de registros
 * - SC1-SC15 (W-AK) → acuerdos + cuotas (solo 9 filas con data)
 */

import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../src/config/env';
import { v4 as uuidv4 } from 'uuid';

interface HistoricoRow {
  CI?: string;
  Nombre?: string;
  Rit?: string;
  Tribunal?: string;
  Recupero?: number;
  '%'?: number;
  Honorario?: number;
  Gastos?: number;
  Estado?: string;
  'Fecha2'?: number;
  'SC1'?: number;
  'SC2'?: number;
  'SC3'?: number;
  'SC4'?: number;
  'SC5'?: number;
  'SC6'?: number;
  'SC7'?: number;
  'SC8'?: number;
  'SC9'?: number;
  'SC10'?: number;
  'SC11'?: number;
  'SC12'?: number;
  'SC13'?: number;
  'SC14'?: number;
  'SC15'?: number;
  'Cuotas'?: number;
  'FP Prox Cuota'?: number;
  'Monto Cuota'?: number;
  'Fecha Cuota'?: number;
}

// Excel serial date (1899-12-30 epoch) to ISO string (YYYY-MM-DD)
function excelDateToISO(serial: number | undefined): string | null {
  if (!serial || serial < 1) return null;
  try {
    const epochTime = (serial - 25569) * 86400 * 1000;
    const isoString = new Date(epochTime).toISOString().split('T')[0];
    return isoString;
  } catch {
    return null;
  }
}

// Map Estado string to case_state enum
function mapEstadoToCaseState(estado: string | undefined): 'activo' | 'desistido' | 'caducado' | 'pagado' {
  if (!estado) return 'activo';
  const lower = estado.toLowerCase().trim();

  // Pagado states
  if (lower.includes('pagado y liquidado')) return 'pagado';
  if (lower === 'pagada') return 'pagado';
  if (lower.includes('desistimiento - pagado')) return 'pagado';

  // Desistido states
  if (lower.includes('desistimiento')) return 'desistido';
  if (lower.includes('rechaza')) return 'desistido';
  if (lower.includes('incobrable')) return 'desistido';

  // Caducado states
  if (lower.includes('caducada') || lower.includes('caducado')) return 'caducado';

  // Default
  return 'activo';
}

// Extract cuota amounts from SC1-SC15 columns
function extractCuotasFromRow(row: HistoricoRow): number[] {
  const cuotas: number[] = [];
  for (let i = 1; i <= 15; i++) {
    const key = `SC${i}` as keyof HistoricoRow;
    const val = row[key];
    if (typeof val === 'number' && val > 0) {
      cuotas.push(val);
    }
  }
  return cuotas;
}

async function importHistoricas() {
  const env = getEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Read Excel file
  const filePath = './b/historicas.xlsx';
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<HistoricoRow>(ws);

  console.log(`\n📥 Starting import of ${rows.length} historical cases...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  const statsConversations = { inserted: 0, skipped: 0 };
  const statsRegistros = { cobranza: 0, honorarios: 0, gasto: 0 };
  const statsAcuerdos = { inserted: 0 };

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const rowNum = rowIdx + 2; // Excel row number (1-indexed + header)

    try {
      // Extract basic data
      const rit = (row.Rit || '').trim();
      const clienteNombre = (row.Nombre || '').trim();
      const clienteRut = (row.CI || '').trim();
      const tribunal = (row.Tribunal || '').trim();
      const estado = mapEstadoToCaseState(row.Estado);
      const recupero = typeof row.Recupero === 'number' ? row.Recupero : 0;
      const porcentajeHonorarios = (typeof row['%'] === 'number' ? row['%'] : 0) * 100;
      const honorarioAmount = typeof row.Honorario === 'number' ? row.Honorario : 0;
      const gastos = typeof row.Gastos === 'number' ? row.Gastos : 0;
      const fecha2 = excelDateToISO(row.Fecha2);

      // Validate required fields
      if (!rit || !clienteNombre) {
        console.warn(`⚠️  Row ${rowNum}: Skipping — missing RIT or Nombre`);
        skippedCount++;
        continue;
      }

      const causaId = rit;

      // 1. Check if conversation already exists (idempotency)
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('causa_id', causaId)
        .single();

      if (existing) {
        console.log(`   Row ${rowNum}: Skipped (already imported: ${causaId})`);
        skippedCount++;
        statsConversations.skipped++;
        continue;
      }

      // 2. Create conversation
      const conversationId = uuidv4();
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          id: conversationId,
          causa_id: causaId,
          cliente_nombre: clienteNombre,
          cliente_rut: clienteRut,
          tribunal: tribunal,
          rit: rit,
          case_state: estado,
          ingreso_honorarios: honorarioAmount,
          pagos_pendientes: 0,
          message_count: 0,
          metadata: {
            imported_from: 'historicas.xlsx',
            porcentajeHonorarios: porcentajeHonorarios,
          },
        })
        .select()
        .single();

      if (convError) {
        console.error(`❌ Row ${rowNum} (${causaId}): Failed to create conversation:`, convError.message);
        errorCount++;
        continue;
      }

      statsConversations.inserted++;

      // 3. Insert registros (cobranza, honorarios, gasto)
      if (recupero > 0) {
        const { error: registroError } = await supabase.from('registros').insert({
          conversation_id: conversationId,
          tipo: 'cobranza',
          monto: recupero,
          fecha: fecha2 || new Date().toISOString().split('T')[0],
          notas: `Imported from historicas.xlsx`,
        });

        if (registroError) {
          console.warn(`   ⚠️  Row ${rowNum}: Failed to create cobranza registro:`, registroError.message);
        } else {
          statsRegistros.cobranza++;
        }
      }

      if (honorarioAmount > 0) {
        const { error: registroError } = await supabase.from('registros').insert({
          conversation_id: conversationId,
          tipo: 'honorarios',
          monto: honorarioAmount,
          fecha: fecha2 || new Date().toISOString().split('T')[0],
          notas: `${porcentajeHonorarios}% | Imported from historicas.xlsx`,
        });

        if (registroError) {
          console.warn(`   ⚠️  Row ${rowNum}: Failed to create honorarios registro:`, registroError.message);
        } else {
          statsRegistros.honorarios++;
        }
      }

      if (gastos > 0) {
        const { error: registroError } = await supabase.from('registros').insert({
          conversation_id: conversationId,
          tipo: 'gasto',
          monto: gastos,
          fecha: fecha2 || new Date().toISOString().split('T')[0],
          notas: `Imported from historicas.xlsx`,
        });

        if (registroError) {
          console.warn(`   ⚠️  Row ${rowNum}: Failed to create gasto registro:`, registroError.message);
        } else {
          statsRegistros.gasto++;
        }
      }

      // 4. Insert acuerdos + cuotas if SC1-SC15 have data
      const cuotasMontos = extractCuotasFromRow(row);
      if (cuotasMontos.length > 0) {
        const montoTotal = cuotasMontos.reduce((a, b) => a + b, 0);
        const acuerdoId = uuidv4();

        const { error: acuerdoError } = await supabase.from('acuerdos').insert({
          id: acuerdoId,
          conversation_id: conversationId,
          monto_total: montoTotal,
          numero_cuotas: cuotasMontos.length,
          estado: 'vigente',
          metadata: { imported_from: 'historicas.xlsx' },
        });

        if (acuerdoError) {
          console.warn(`   ⚠️  Row ${rowNum}: Failed to create acuerdo:`, acuerdoError.message);
        } else {
          statsAcuerdos.inserted++;

          // Insert individual cuotas
          const cuotasToInsert = cuotasMontos.map((monto, idx) => ({
            acuerdo_id: acuerdoId,
            numero_cuota: idx + 1,
            monto: monto,
            fecha_vencimiento: null,
            fecha_pago: null,
            estado: 'pendiente' as const,
          }));

          const { error: cuotasError } = await supabase.from('cuotas').insert(cuotasToInsert);
          if (cuotasError) {
            console.warn(
              `   ⚠️  Row ${rowNum}: Failed to create ${cuotasMontos.length} cuotas:`,
              cuotasError.message
            );
          }
        }
      }

      successCount++;
      if (successCount % 10 === 0) {
        console.log(`✓ Progress: ${successCount}/${rows.length} cases`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`❌ Row ${rowNum}: Unexpected error:`, error);
      errorCount++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Import complete!\n`);
  console.log(`📊 Summary:`);
  console.log(`   Conversations: ${statsConversations.inserted} inserted, ${statsConversations.skipped} skipped`);
  console.log(`   Registros:`);
  console.log(`      - Cobranza: ${statsRegistros.cobranza}`);
  console.log(`      - Honorarios: ${statsRegistros.honorarios}`);
  console.log(`      - Gastos: ${statsRegistros.gasto}`);
  console.log(`   Acuerdos: ${statsAcuerdos.inserted} inserted`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`\n`);

  process.exit(0);
}

importHistoricas();
