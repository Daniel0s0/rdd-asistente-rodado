// src/sheets/outbox.ts — Sincronización resiliente con Google Sheets (Etapa 4.1)
//
// Patrón outbox: las operaciones de Sheets que fallan (o las financieras del
// agente) se encolan en la tabla sheets_outbox y un worker las reintenta.
// Garantía: ningún registro de ingreso se pierde por una caída transitoria
// de Google Sheets.

import { logger } from '@utils/logger';
import { appendRegistroRow, updateRegistroRow } from './client';
import {
  createOutboxEntry,
  getOutboxPendientes,
  markOutboxProcesado,
  markOutboxFallido,
  SheetsOutboxEntry,
  SheetsOutboxOperation,
} from '@database/models';
import type { RegistroRow } from '@domain/rdd';

/** Tras este número de intentos fallidos el entry pasa a estado 'error'. */
export const MAX_INTENTOS = 5;

/**
 * Encola una operación de Sheets para procesamiento asíncrono.
 * No lanza: si la DB también falla, solo se loguea (el dato de negocio ya
 * está persistido en Supabase por el caller; esto es solo la réplica a Sheets).
 */
export async function enqueueSheetsOperation(
  operation: SheetsOutboxOperation,
  causaId: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  try {
    await createOutboxEntry(operation, causaId, payload);
    return true;
  } catch (error) {
    logger.error(
      { error, operation, causaId },
      'Sheets outbox: no se pudo encolar la operación (DB caída?)'
    );
    return false;
  }
}

async function executeOutboxEntry(entry: SheetsOutboxEntry): Promise<void> {
  switch (entry.operation) {
    case 'append_registro':
      await appendRegistroRow(entry.payload as unknown as RegistroRow);
      break;
    case 'update_registro': {
      // El payload viene de buildSheetsSyncData ({ intent, monto, cuotas, fecha,
      // porcentajeHonorarios }); updateRegistroRow espera columnas con nombre
      // según el tipo de evento (acuerdo vs pago).
      const p = entry.payload as {
        intent?: string;
        monto?: number;
        cuotas?: number;
        fecha?: string;
        porcentajeHonorarios?: number;
      };
      const esPago = p.intent === 'pago';
      await updateRegistroRow(entry.causa_id, {
        tipoIngreso: p.intent,
        ...(esPago
          ? { montoPago: p.monto, fechaPago: p.fecha }
          : { acuerdoMonto: p.monto, acuerdoCuotas: p.cuotas, acuerdoFecha: p.fecha }),
        porcentajeHonorarios: p.porcentajeHonorarios,
      });
      break;
    }
    default:
      throw new Error(`Operación de outbox desconocida: ${entry.operation}`);
  }
}

/**
 * Procesa los entries pendientes del outbox (FIFO).
 * Devuelve conteos para logging/observabilidad.
 */
export async function processSheetsOutbox(
  limit = 10
): Promise<{ procesados: number; fallidos: number }> {
  let pendientes: SheetsOutboxEntry[];
  try {
    pendientes = await getOutboxPendientes(limit);
  } catch (error) {
    logger.error({ error }, 'Sheets outbox: no se pudieron leer pendientes');
    return { procesados: 0, fallidos: 0 };
  }

  let procesados = 0;
  let fallidos = 0;

  for (const entry of pendientes) {
    try {
      await executeOutboxEntry(entry);
      await markOutboxProcesado(entry.id);
      procesados++;
      logger.info(
        { outboxId: entry.id, operation: entry.operation, causaId: entry.causa_id },
        'Sheets outbox: operación procesada'
      );
    } catch (error) {
      fallidos++;
      const msg = error instanceof Error ? error.message : String(error);
      try {
        await markOutboxFallido(entry.id, entry.intentos + 1, msg, MAX_INTENTOS);
      } catch (dbError) {
        logger.error({ dbError, outboxId: entry.id }, 'Sheets outbox: no se pudo marcar fallo');
      }
      logger.warn(
        { outboxId: entry.id, operation: entry.operation, intentos: entry.intentos + 1, error: msg },
        'Sheets outbox: operación falló, se reintentará'
      );
    }
  }

  return { procesados, fallidos };
}

let workerTimer: NodeJS.Timeout | null = null;
let procesando = false;

/** Corre un ciclo del worker evitando solapamiento. */
async function tick(): Promise<void> {
  if (procesando) return;
  procesando = true;
  try {
    await processSheetsOutbox();
  } finally {
    procesando = false;
  }
}

/**
 * Inicia el worker periódico del outbox. Idempotente.
 * unref(): el timer no impide el graceful shutdown del proceso.
 */
export function startSheetsOutboxWorker(intervalMs = 60_000): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => void tick(), intervalMs);
  workerTimer.unref();
  logger.info({ intervalMs }, 'Sheets outbox worker iniciado');
}

export function stopSheetsOutboxWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

/**
 * Dispara un procesamiento inmediato sin bloquear al caller.
 * Útil tras encolar: el dato llega a Sheets en segundos, no al próximo tick.
 */
export function kickSheetsOutbox(): void {
  void tick();
}
