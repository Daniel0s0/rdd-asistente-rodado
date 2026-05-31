import XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const estadoToState: Record<string, string> = {
  'Activo': 'activo',
  'Acuerdo': 'acuerdo',
  'Archivado': 'archivado',
  'Desistido': 'desistido',
  'Caducado': 'caducado',
  'Rechaza Dda': 'desistido',
  'Pendiente': 'activo',
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

function previewHistoricas() {
  console.log('📂 Leyendo archivo de causas históricas...\n');

  const filePath = path.join(process.cwd(), 'b/historicas.xlsx');
  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);

  console.log(`✅ Total de causas: ${data.length}\n`);

  // Count by estado
  const estadoCounts: Record<string, number> = {};
  const caseStateCounts: Record<string, number> = {};

  data.forEach((row) => {
    const estado = row.Estado || 'N/A';
    const caseState = estadoToState[estado] || 'activo';

    estadoCounts[estado] = (estadoCounts[estado] || 0) + 1;
    caseStateCounts[caseState] = (caseStateCounts[caseState] || 0) + 1;
  });

  console.log('📊 DISTRIBUCIÓN POR ESTADO (Excel):');
  Object.entries(estadoCounts).forEach(([estado, count]) => {
    console.log(`  ${estado}: ${count}`);
  });

  console.log('\n📊 DISTRIBUCIÓN POR CASE_STATE (RDD):');
  Object.entries(caseStateCounts).forEach(([state, count]) => {
    console.log(`  ${state}: ${count}`);
  });

  // Tribunales únicos
  const tribunales = Array.from(new Set(data.map((r) => r.Tribunal).filter(Boolean)));
  console.log(`\n🏛️  TRIBUNALES ÚNICOS (${tribunales.length}):`);
  tribunales.slice(0, 10).forEach((t) => console.log(`  - ${t}`));
  if (tribunales.length > 10) console.log(`  ... y ${tribunales.length - 10} más`);

  // Muestras de datos
  console.log('\n📋 PRIMERAS 5 CAUSAS (MAPEO FINAL):\n');

  data.slice(0, 5).forEach((row, idx) => {
    const causaId = row.Rit || `HIST-${uuidv4().slice(0, 8)}`;
    const caseState = estadoToState[row.Estado] || 'activo';

    let createdAt = new Date();
    if (row.Fecha2 && typeof row.Fecha2 === 'number' && row.Fecha2 > 0) {
      createdAt = new Date((row.Fecha2 - 25569) * 86400 * 1000);
    }

    console.log(`${idx + 1}. ${causaId}`);
    console.log(`   Cliente: ${row.Nombre}`);
    console.log(`   Tribunal: ${row.Tribunal}`);
    console.log(`   Estado Excel → RDD: "${row.Estado}" → "${caseState}"`);
    console.log(`   Recupero: $${row.Recupero} | % Honorarios: ${row['%']}`);
    console.log(`   Fecha: ${createdAt.toLocaleDateString('es-CL')}`);
    console.log(`   RUT: ${row.CI}`);
    console.log();
  });

  console.log(
    '✅ Vista previa completada.\n' +
      '➡️  Cuando esté listo, ejecuta:\n' +
      '   export SERVICE_ROLE_KEY="<tu_clave>" && npm run seed:historicas'
  );
}

previewHistoricas();
