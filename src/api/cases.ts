import { Request, Response } from 'express';
import { listConversations } from '@database/models';
import { getLogger } from '@utils/logger';

const logger = getLogger();

/**
 * Handler for GET /cases
 *
 * Lists conversations (cases) with advanced filtering and pagination.
 *
 * Query Parameters:
 *   ?open=false → include closed cases (default: only open)
 *   ?q=texto → search by client name, demandado, RIT, tribunal, causa_id
 *   ?tribunal=Laboral → filter by tribunal
 *   ?etapa=cobranza → filter by etapa (litigacion | cobranza)
 *   ?case_state=activo → filter by case state (activo | acuerdo | archivado | desistido | caducado)
 *   ?from=2026-01-01 → filter by created_at >= date
 *   ?to=2026-05-31 → filter by created_at <= date
 *   ?limit=20 → max results (default: 50)
 *   ?offset=0 → pagination offset (default: 0)
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       cases: [
 *         {
 *           causaId, status, createdAt,
 *           clienteNombre, demandado, tribunal, rit, etapa,
 *           caseState, ingresoHonorarios, pagosPendientes
 *         },
 *         ...
 *       ],
 *       total: number
 *     },
 *     timestamp: ISO string
 *   }
 */
export async function casesHandler(req: Request, res: Response): Promise<void> {
  try {
    const onlyOpen = req.query.open !== 'false';
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const conversations = await listConversations({
      onlyOpen,
      limit,
      offset,
      q: req.query.q as string | undefined,
      tribunal: req.query.tribunal as string | undefined,
      etapa: req.query.etapa as string | undefined,
      case_state: req.query.case_state as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });

    res.json({
      success: true,
      data: {
        cases: conversations.map((c) => ({
          causaId: c.causa_id,
          status: c.closed_at ? 'closed' : 'active',
          createdAt: c.created_at.toISOString ? c.created_at.toISOString() : c.created_at,
          clienteNombre: c.cliente_nombre,
          demandado: c.demandado,
          tribunal: c.tribunal,
          rit: c.rit,
          etapa: c.etapa,
          caseState: c.case_state,
          ingresoHonorarios: c.ingreso_honorarios,
          pagosPendientes: c.pagos_pendientes,
        })),
        total: conversations.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message }, 'casesHandler: database error');
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Error listing cases',
      timestamp: new Date().toISOString(),
    });
  }
}
