---
paths: ["src/sheets/**/*", "src/drive/**/*"]
---

# Google APIs Patterns para RDD

Cómo interactuar con Sheets y Drive de forma segura.

---

## Google Service Account Auth

**NUNCA uses OAuth interactivo. SIEMPRE service account:**

```typescript
import { google } from 'googleapis';

const serviceAccountKey = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64!,
    'base64'
  ).toString()
);

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccountKey,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ]
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });
```

**NUNCA loguees las credenciales:**
```typescript
// ❌ WRONG
logger.debug('Service account:', serviceAccountKey);

// ✅ CORRECT
logger.debug('Google auth initialized with service account');
```

---

## Sheets: Safe Update Pattern

**Atomicity: TODO o NADA.**

```typescript
async function updateRegistroRow(causaId: string, data: FinancialData) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
  
  try {
    // 1. Validar datos ANTES de tocar Sheets
    validateBeforeSheets(data);
    
    // 2. Calcular fórmulas localmente
    const honorarios = data.monto * (data.porcentajeHonorarios / 100);
    const neto = data.monto - data.gastos - honorarios;
    
    // 3. Actualizar row
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `REGISTRO!A${data.rowNumber}:Z${data.rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          causaId,
          data.clienteNombre,
          data.demandado,
          data.tipoIngreso,
          data.monto,
          data.porcentajeHonorarios,
          honorarios,
          data.gastos,
          neto,
          // ... otros campos
        ]]
      }
    });
    
    // 4. Actualizar DASHBOARD (dependientes)
    await recalculateDashboard();
    
    // 5. Log de auditoría
    await auditLog.record({
      tipo: 'REGISTRO_UPDATE',
      causaId,
      usuarioId: 'rdd',
      timestamp: new Date(),
      cambios: {
        tipoIngreso: data.tipoIngreso,
        monto: data.monto,
        honorarios
      }
    });
    
    return { success: true, rowUpdated: data.rowNumber };
  } catch (error) {
    logger.error('[SHEETS] Update failed:', error);
    throw error;  // Fail fast, don't hide errors
  }
}
```

---

## Sheets: Rate Limiting + Retry

**Google Sheets: ~100 req/min. Queue y retry:**

```typescript
import PQueue from 'p-queue';

const sheetsQueue = new PQueue({ concurrency: 1, interval: 60000, intervalCap: 80 });

async function callSheetsWithQueue(fn: () => Promise<any>) {
  return sheetsQueue.add(fn);
}

async function callSheetsWithRetry(fn: () => Promise<any>, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callSheetsWithQueue(fn);
    } catch (error) {
      if (error.code === 429 && attempt < maxAttempts - 1) {
        // Rate limited, exponential backoff
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        logger.warn(`[SHEETS] Rate limited, retrying in ${delayMs}ms`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw error;
      }
    }
  }
}
```

---

## Drive: Upload Comprobantes

**Subir PDF a carpeta correcta:**

```typescript
async function uploadComprobante(
  causaId: string,
  driveFolderId: string,
  pdfBuffer: Buffer,
  tipoComprobante: 'acuerdo_pago' | 'transferencia' | 'pago_cuota'
) {
  // 1. Validar folder existe
  const folder = await drive.files.get({
    fileId: driveFolderId,
    fields: 'id, name'
  });
  if (!folder.data.id) {
    throw new Error(`Drive folder no encontrado: ${driveFolderId}`);
  }
  
  // 2. Generar nombre único
  const timestamp = new Date().toISOString().split('T')[0];  // YYYY-MM-DD
  const fileName = `${tipoComprobante}_${causaId}_${timestamp}.pdf`;
  
  // 3. Subir archivo
  const { Readable } = await import('stream');
  const stream = Readable.from(pdfBuffer);
  
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/pdf',
      parents: [driveFolderId],
      description: `RDD comprobante para causa ${causaId}`
    },
    media: {
      mimeType: 'application/pdf',
      body: stream
    },
    fields: 'id, webViewLink'
  });
  
  const fileId = response.data.id;
  
  // 4. Actualizar Sheets con link
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
    range: 'COMPROBANTES!A:C',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        causaId,
        fileName,
        response.data.webViewLink
      ]]
    }
  });
  
  return { fileId, url: response.data.webViewLink };
}
```

---

## Drive: Rate Limiting

**Google Drive: ~1000 req/min. Menos crítico pero vigila:**

```typescript
const driveQueue = new PQueue({ concurrency: 5, interval: 60000, intervalCap: 800 });

async function callDriveWithQueue(fn: () => Promise<any>) {
  return driveQueue.add(fn);
}
```

---

## Error Handling: Google APIs

**Diferentes errores, diferentes respuestas:**

```typescript
async function handleGoogleError(error: any, context: string) {
  logger.error(`[GOOGLE] ${context}:`, error.message);
  
  switch (error.code || error.status) {
    case 401:
      throw new AuthError('Service account auth failed');
    
    case 403:
      throw new PermissionError('RDD no tiene permiso en Sheets/Drive');
    
    case 404:
      throw new NotFoundError(`Recurso no encontrado: ${context}`);
    
    case 429:
      throw new RateLimitError('Google throttling, retry later');
    
    case 500:
    case 503:
      throw new TemporaryError('Google API unavailable, retry');
    
    default:
      throw error;
  }
}
```

---

## Validation: Financial Data

**NUNCA guardes datos financieros inválidos:**

```typescript
function validateFinancialData(data: {
  monto?: number;
  porcentajeHonorarios?: number;
  gastos?: number;
  cuotas?: number;
  fechaPago?: Date;
  fechaAcuerdo?: Date;
}) {
  const errors: string[] = [];
  
  // Montos
  if (data.monto !== undefined && data.monto <= 0) {
    errors.push('Monto debe ser > 0');
  }
  if (data.gastos !== undefined && data.gastos < 0) {
    errors.push('Gastos no pueden ser negativos');
  }
  
  // Porcentajes
  if (data.porcentajeHonorarios !== undefined) {
    if (data.porcentajeHonorarios < 0 || data.porcentajeHonorarios > 100) {
      errors.push('Porcentaje honorarios debe estar entre 0-100%');
    }
  }
  
  // Cuotas
  if (data.cuotas !== undefined) {
    if (data.cuotas < 1 || !Number.isInteger(data.cuotas)) {
      errors.push('Cuotas debe ser número entero >= 1');
    }
  }
  
  // Fechas lógicas
  if (data.fechaPago && data.fechaAcuerdo) {
    if (data.fechaPago < data.fechaAcuerdo) {
      errors.push('Fecha de pago no puede ser anterior a acuerdo');
    }
  }
  
  if (errors.length > 0) {
    throw new ValidationError(errors.join(', '));
  }
}
```

---

## Audit Logging

**Registra TODOS los cambios para compliance:**

```typescript
async function auditLog(action: string, data: any) {
  const timestamp = new Date().toISOString();
  
  // Loguear en Sheets "AUDITORIA" tab
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
    range: 'AUDITORIA!A:E',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        timestamp,
        action,
        data.causaId || 'N/A',
        JSON.stringify(data.cambios || {}),
        data.usuarioId || 'rdd-system'
      ]]
    }
  });
  
  // Loguear en console para debugging
  logger.info(`[AUDIT] ${action}`, {
    timestamp,
    causaId: data.causaId,
    cambios: data.cambios
  });
}
```
