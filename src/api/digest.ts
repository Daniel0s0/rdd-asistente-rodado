// src/api/digest.ts — Session Digest (Etapa 4.3)
//
// GET /agent/digest: resumen proactivo del estado de la cartera para empezar
// la sesión de trabajo: (a) casos con acción pendiente del agente, (b) acuerdos
// con cuotas vencidas, (c) cuotas que vencen en los próximos 7 días.
// Determinístico (sin Claude): instantáneo, sin costo y testeable. Para
// narrativa conversacional está el Portfolio Chat.

import { Request, Response } from 'express';
import { logger } from '@utils/logger';
import {
  getAcuerdosStatus,
  getCasosConPendingAction,
  AcuerdoStatus,
  CasoPendiente,
} from '@database/analytics-queries';

const DIAS_VENTANA_VENCIMIENTO = 7;

function buildResumen(
  pendientes: CasoPendiente[],
  vencidos: AcuerdoStatus[],
  porVencer: AcuerdoStatus[]
): string {
  const lineas: string[] = ['📋 Digest de la cartera:'];

  if (pendientes.length > 0) {
    lineas.push(
      `⚡ ${pendientes.length} caso(s) con acción pendiente: ${pendientes
        .map((p) => p.causaId)
        .join(', ')} — abre el chat de cada causa para resolverla.`
    );
  }

  if (vencidos.length > 0) {
    lineas.push(
      `🔴 ${vencidos.length} acuerdo(s) con cuotas vencidas: ${vencidos
        .map((a) => `${a.causaId} (${a.cuotasVencidas} vencida(s))`)
        .join(', ')}.`
    );
  }

  if (porVencer.length > 0) {
    lineas.push(
      `🟡 ${porVencer.length} cuota(s) vencen en los próximos ${DIAS_VENTANA_VENCIMIENTO} días: ${porVencer
        .map((a) => `${a.causaId} (${a.proximoVencimiento})`)
        .join(', ')}.`
    );
  }

  if (lineas.length === 1) {
    lineas.push('✅ Sin acciones pendientes ni vencimientos próximos. Cartera al día.');
  }

  return lineas.join('\n');
}

export async function digestHandler(_req: Request, res: Response): Promise<void> {
  try {
    const [acuerdos, pendientes] = await Promise.all([
      getAcuerdosStatus(),
      getCasosConPendingAction(),
    ]);

    const hoy = new Date().toISOString().split('T')[0];
    const limite = new Date(Date.now() + DIAS_VENTANA_VENCIMIENTO * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const vencidos = acuerdos.filter((a) => a.cuotasVencidas > 0);
    const porVencer = acuerdos.filter(
      (a) =>
        a.cuotasVencidas === 0 &&
        a.proximoVencimiento !== null &&
        a.proximoVencimiento >= hoy &&
        a.proximoVencimiento <= limite
    );

    res.json({
      generated_at: new Date().toISOString(),
      acciones_pendientes: pendientes,
      acuerdos_vencidos: vencidos,
      proximos_vencimientos: porVencer,
      resumen: buildResumen(pendientes, vencidos, porVencer),
    });
  } catch (error) {
    logger.error({ error }, 'digestHandler: error generando digest');
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Error generando digest',
      timestamp: new Date().toISOString(),
    });
  }
}
