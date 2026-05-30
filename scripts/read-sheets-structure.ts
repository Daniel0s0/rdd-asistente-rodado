import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

async function readRegistroStructure() {
  try {
    // Leer .env
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');

    // Extraer credenciales
    const keyBase64Match = envContent.match(/GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=(.+?)(?:\n|$)/);
    const emailMatch = envContent.match(/GOOGLE_SERVICE_ACCOUNT_EMAIL=(.+?)(?:\n|$)/);
    const sheetsIdMatch = envContent.match(/GOOGLE_SHEETS_SPREADSHEET_ID=(.+?)(?:\n|$)/);

    if (!keyBase64Match || !emailMatch || !sheetsIdMatch) {
      console.error('❌ Faltan credenciales en .env');
      console.error('Necesario:');
      console.error('  - GOOGLE_SERVICE_ACCOUNT_KEY_BASE64');
      console.error('  - GOOGLE_SERVICE_ACCOUNT_EMAIL');
      console.error('  - GOOGLE_SHEETS_SPREADSHEET_ID');
      process.exit(1);
    }

    const spreadsheetId = sheetsIdMatch[1].trim();
    const keyJson = JSON.parse(
      Buffer.from(keyBase64Match[1].trim(), 'base64').toString('utf-8')
    );

    // Autenticar
    const auth = new JWT({
      email: emailMatch[1].trim(),
      key: keyJson.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Obtener lista de tabs
    console.log('\n📊 Leyendo Sheets...\n');

    const metadata = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    console.log('📑 Pestañas disponibles:');
    metadata.data.sheets?.forEach(sheet => {
      console.log(`   - ${sheet.properties?.title}`);
    });

    // Leer REGISTRO (primeras 3 filas para ver headers y contexto)
    console.log('\n📋 Leyendo pestaña REGISTRO...\n');

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'REGISTRO!1:3',
    });

    const values = response.data.values || [];

    if (values.length === 0) {
      console.log('⚠️  REGISTRO está vacío');
      process.exit(0);
    }

    // Headers
    const headers = values[0];
    console.log('✅ COLUMNAS DEL REGISTRO:');
    console.log('');
    headers.forEach((header: string, index: number) => {
      const col = String.fromCharCode(65 + index); // A, B, C, ...
      console.log(`   ${col}: ${header}`);
    });

    // Mostrar datos de ejemplo
    if (values.length > 1) {
      console.log('\n📌 Datos de ejemplo (primera fila):');
      console.log('');
      headers.forEach((header: string, index: number) => {
        const value = values[1][index] || '[vacío]';
        console.log(`   ${header}: ${value}`);
      });
    }

    if (values.length > 2) {
      console.log('\n📌 Segunda fila (si existe):');
      console.log('');
      headers.forEach((header: string, index: number) => {
        const value = values[2][index] || '[vacío]';
        console.log(`   ${header}: ${value}`);
      });
    }

    console.log('\n✅ Estructura leída exitosamente\n');

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
      if (error.message.includes('Invalid JSON')) {
        console.error('\n⚠️  El GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 podría estar mal codificado');
      }
    } else {
      console.error('❌ Error desconocido:', error);
    }
    process.exit(1);
  }
}

readRegistroStructure();
