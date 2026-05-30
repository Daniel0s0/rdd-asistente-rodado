import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { RegistroRow } from '@domain/rdd';

let sheetsClient: sheets_v4.Sheets | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Retry con Backoff Exponencial
// ─────────────────────────────────────────────────────────────────────────────

const SHEETS_RETRY_MAX_ATTEMPTS = 3;
const SHEETS_RETRY_BASE_DELAY_MS = 1000; // 1 segundo

/**
 * Reintenta una operación con backoff exponencial ante errores transitorios.
 *
 * Errores reintentables: 429 (rate limit) y 5xx (errores de servidor).
 * Errores no reintentables (4xx distintos a 429): se lanzan inmediatamente.
 * Patrón de espera: 1s → 2s → 4s (si maxAttempts = 3).
 *
 * Cumple DI #6 (Rate Limiting) y DI #9 (Error Recovery).
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = SHEETS_RETRY_MAX_ATTEMPTS
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error as any;
      lastError = error as Error;

      // Determinar si el error es reintentable (429 rate limit o 5xx servidor)
      const statusCode = err.code ?? err.status ?? 0;
      const isRetryable = statusCode === 429 || statusCode >= 500;

      if (isRetryable && attempt < maxAttempts - 1) {
        // Backoff exponencial: 1s, 2s, 4s, ...
        const delayMs = SHEETS_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(
          { attempt: attempt + 1, maxAttempts, delayMs, codigo: statusCode },
          'Solicitud a Google Sheets falló, reintentando con backoff'
        );
        await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      } else if (!isRetryable) {
        // Error no reintentable (401, 403, 404, etc.) — lanzar inmediatamente
        throw error;
      }
      // Si es reintentable pero ya agotamos intentos, salir del loop
    }
  }

  // Todos los intentos agotados
  if (lastError) {
    throw lastError;
  }
  throw new Error('Error desconocido en retryWithBackoff');
}

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) {
    return sheetsClient;
  }

  const env = getEnv();
  const keyBuffer = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64');
  const keyJson = JSON.parse(keyBuffer.toString('utf-8'));

  const auth = new JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: keyJson.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function appendRegistroRow(row: RegistroRow): Promise<string> {
  const env = getEnv();
  const client = await getSheetsClient();

  const values = [
    [
      row.causaId,
      row.clienteNombre,
      row.clienteRut || '',
      row.demandado || '',
      row.rit || '',
      row.tribunal || '',
      row.driveFolderId,
      row.fechaIngreso,
    ],
  ];

  try {
    const result = await client.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: 'REGISTRO!A:H',
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    const updatedRange = result.data.updates?.updatedRange || '';
    const match = updatedRange.match(/!([A-Z]+)(\d+)/);
    if (match) {
      return `${match[1]}${match[2]}`;
    }

    throw new Error(`Unable to parse row from Sheets response: ${updatedRange}`);
  } catch (error) {
    logger.error({ error, causaId: row.causaId }, 'appendRegistroRow failed');
    throw error;
  }
}

/**
 * Actualiza una fila del tab REGISTRO con datos financieros nuevos.
 *
 * Se llama después de que el agente procesa exitosamente un acuerdo o pago.
 * Realiza la actualización de forma atómica con retry: lectura → merge → escritura.
 *
 * Cumple DI #4 (atomicidad Sheets: TODO o NADA).
 * Cumple DI #6 (retry con backoff exponencial ante 429 y 5xx).
 *
 * @param causaId - ID de la causa legal
 * @param updates - Campos a actualizar
 * @throws Error si la fila no se encuentra o la actualización falla tras max reintentos
 */
export async function updateRegistroRow(
  causaId: string,
  updates: {
    tipoIngreso?: string;
    acuerdoMonto?: number;
    acuerdoCuotas?: number;
    acuerdoFecha?: string;
    montoPago?: number;
    fechaPago?: string;
    porcentajeHonorarios?: number;
  }
): Promise<void> {
  const env = getEnv();

  try {
    const client = await getSheetsClient();

    // 1. Buscar fila por causa_id (con retry)
    const response = await retryWithBackoff(() =>
      client.spreadsheets.values.get({
        spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
        range: 'REGISTRO!A:A',
      })
    );

    const rows = response.data.values || [];
    let targetRowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.[0] === causaId) {
        targetRowIndex = i + 1; // 1-indexed
        break;
      }
    }

    if (targetRowIndex === -1) {
      throw new Error(`Causa ${causaId} no encontrada en tab REGISTRO`);
    }

    // 2. Leer fila actual (con retry)
    const getRowResponse = await retryWithBackoff(() =>
      client.spreadsheets.values.get({
        spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
        range: `REGISTRO!A${targetRowIndex}:O${targetRowIndex}`,
      })
    );

    const currentRow = getRowResponse.data.values?.[0] || [];

    // 3. Merge de valores actuales con los nuevos (preservar existentes si no se proveen)
    const updatedRow = [
      currentRow[0],  // causaId
      currentRow[1],  // clienteNombre
      currentRow[2],  // clienteRut
      currentRow[3],  // demandado
      currentRow[4],  // rit
      currentRow[5],  // tribunal
      currentRow[6],  // driveFolderId
      currentRow[7],  // fechaIngreso
      updates.tipoIngreso ?? currentRow[8] ?? '',
      updates.acuerdoMonto ?? currentRow[9] ?? '',
      updates.acuerdoCuotas ?? currentRow[10] ?? '',
      updates.acuerdoFecha ?? currentRow[11] ?? '',
      updates.montoPago ?? currentRow[12] ?? '',
      updates.fechaPago ?? currentRow[13] ?? '',
      updates.porcentajeHonorarios ?? currentRow[14] ?? '',
    ];

    // 4. Actualizar fila (con retry) — operación atómica: TODO o NADA
    const updateResponse = await retryWithBackoff(() =>
      client.spreadsheets.values.update({
        spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
        range: `REGISTRO!A${targetRowIndex}:O${targetRowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [updatedRow],
        },
      })
    );

    if (!updateResponse.data.updatedCells || updateResponse.data.updatedCells === 0) {
      throw new Error('La actualización en Sheets no retornó celdas actualizadas');
    }

    logger.info(
      { causaId, rowIndex: targetRowIndex, updates },
      'Fila REGISTRO actualizada exitosamente'
    );
  } catch (error) {
    const err = error as any;
    logger.error(
      { causaId, error: err.message, codigo: err.code ?? err.status },
      'updateRegistroRow falló'
    );
    throw error;
  }
}
