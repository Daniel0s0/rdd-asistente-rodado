#!/usr/bin/env node

import { google } from 'googleapis';
import { config } from 'dotenv';
import * as path from 'path';

// Cargar variables de entorno
const envPath = path.join(__dirname, '../.env.local');
config({ path: envPath });

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
};

async function testDriveConnection() {
  console.log('🔍 Testing Google Drive Connection...\n');

  try {
    // 1. Decodificar credenciales
    console.log('1️⃣  Decoding service account credentials...');
    const keyBase64 = getEnv('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64');
    const keyJson = JSON.parse(
      Buffer.from(keyBase64, 'base64').toString('utf-8')
    );
    console.log(`   ✅ Service Account: ${keyJson.client_email}\n`);

    // 2. Autenticarse con Google Drive
    console.log('2️⃣  Authenticating with Google Drive API...');
    const auth = new google.auth.GoogleAuth({
      credentials: keyJson,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    console.log('   ✅ Authentication successful\n');

    // 3. Obtener la carpeta raíz
    const rootFolderId = getEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID');
    console.log(`3️⃣  Checking root folder access: ${rootFolderId}`);
    const rootFolder = await drive.files.get({
      fileId: rootFolderId,
      fields: 'id, name, mimeType',
    });
    console.log(`   ✅ Root folder: "${rootFolder.data.name}"\n`);

    // 4. Crear carpeta de prueba
    console.log('4️⃣  Creating test folder...');
    const testFolderName = `Test-RDD-${new Date().toISOString().split('T')[0]}`;
    const folderMetadata = {
      name: testFolderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
    };

    const testFolder = await drive.files.create({
      requestBody: folderMetadata,
      fields: 'id, name, webViewLink',
    });

    console.log(`   ✅ Test folder created!\n`);
    console.log(`   📁 Folder Name: ${testFolder.data.name}`);
    console.log(`   📌 Folder ID:   ${testFolder.data.id}`);
    console.log(`   🔗 Drive Link:  ${testFolder.data.webViewLink}\n`);

    // 5. Crear un archivo de prueba dentro
    console.log('5️⃣  Creating test file inside folder...');
    const testFile = await drive.files.create({
      requestBody: {
        name: 'test-file.txt',
        mimeType: 'text/plain',
        parents: [testFolder.data.id!],
      },
      media: {
        mimeType: 'text/plain',
        body: 'Test file created by RDD Agent\n' +
               `Created at: ${new Date().toISOString()}\n` +
               'If you see this, the service account has write access! ✅',
      },
      fields: 'id, name, webViewLink',
    });
    console.log(`   ✅ Test file created: "${testFile.data.name}"\n`);

    // Resumen
    console.log('═══════════════════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED!\n');
    console.log('Your Google Drive configuration is working correctly.');
    console.log('\n📋 Summary:');
    console.log(`  • Service Account: ${keyJson.client_email}`);
    console.log(`  • Root Folder: ${rootFolder.data.name} (${rootFolderId})`);
    console.log(`  • Test Folder: ${testFolder.data.name}`);
    console.log(`  • Test Folder ID: ${testFolder.data.id}`);
    console.log('\n💡 Next Steps:');
    console.log('  1. If you want a NEW folder for RDD (separate from SaaS):');
    console.log(`     Copy the folder ID: ${testFolder.data.id}`);
    console.log('     And set GOOGLE_DRIVE_ROOT_FOLDER_ID in .env.local');
    console.log('\n  2. If you want to keep using the current folder:');
    console.log('     No action needed - configuration is correct!');
    console.log('\n═══════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    console.error('\nℹ️  Troubleshooting:');
    console.error('  • Check .env.local exists and has correct values');
    console.error('  • Check service account has Drive API enabled');
    console.error('  • Check folder ID is correct and accessible');
    process.exit(1);
  }
}

testDriveConnection();
