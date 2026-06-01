/**
 * analytics.ts — Portfolio Analytics API (Fase 6.3)
 *
 * Four endpoints for portfolio dashboard:
 *  - GET /analytics/cartera    → KPI summary
 *  - GET /analytics/ingresos   → Income by month + source
 *  - GET /analytics/acuerdos   → Agreement status
 *  - GET /analytics/resultados → Case outcomes
 *
 * All require API Key authentication.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@utils/logger';
import {
  getCartKPI,
  getIncomeData,
  getAcuerdosStatus,
  getCaseResults,
  getCaseDetail,
} from '@database/analytics-queries';
import { createRegistro } from '@database/models';

// ─────────────────────────────────────────────────────────────────────────────
// GET /analytics/cartera
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetCartera(_req: Request, res: Response): Promise<void> {
  try {
    logger.debug({}, 'GET /analytics/cartera');

    const data = await getCartKPI();

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ error }, 'GET /analytics/cartera: error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /analytics/ingresos?from=2026-01&to=2026-05
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetIngresos(req: Request, res: Response): Promise<void> {
  try {
    let { from, to } = req.query;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

    from = (from as string) ?? `${currentYear}-01`;
    to = (to as string) ?? `${currentYear}-${currentMonth}`;

    if (!/^\d{4}-\d{2}$/.test(from as string) || !/^\d{4}-\d{2}$/.test(to as string)) {
      res.status(400).json({
        success: false,
        error: 'from and to must be in format YYYY-MM',
      });
      return;
    }

    const fromFull = `${from}-01`;
    const toDate = new Date(`${to}-01`);
    toDate.setMonth(toDate.getMonth() + 1);
    toDate.setDate(toDate.getDate() - 1);
    const toFull = toDate.toISOString().split('T')[0];

    logger.debug({ from: fromFull, to: toFull }, 'GET /analytics/ingresos');

    const data = await getIncomeData(fromFull, toFull);

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ error }, 'GET /analytics/ingresos: error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /analytics/acuerdos
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetAcuerdos(_req: Request, res: Response): Promise<void> {
  try {
    logger.debug({}, 'GET /analytics/acuerdos');

    const data = await getAcuerdosStatus();

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ error }, 'GET /analytics/acuerdos: error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /analytics/resultados
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetResultados(_req: Request, res: Response): Promise<void> {
  try {
    logger.debug({}, 'GET /analytics/resultados');

    const data = await getCaseResults();

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ error }, 'GET /analytics/resultados: error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /financials/registro
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCreateRegistro(req: Request, res: Response): Promise<void> {
  try {
    const schema = z.object({
      conversation_id: z.string().uuid('Invalid UUID format'),
      tipo: z.enum(['cobranza', 'honorarios', 'gasto', 'sentencia']),
      monto: z.number().positive('Monto debe ser mayor a 0'),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe estar en formato YYYY-MM-DD'),
      notas: z.string().optional(),
    });

    const body = schema.parse(req.body);

    logger.debug({ conversation_id: body.conversation_id, tipo: body.tipo }, 'POST /financials/registro');

    const data = await createRegistro({
      conversationId: body.conversation_id,
      tipo: body.tipo as 'cobranza' | 'honorarios' | 'gasto' | 'sentencia',
      monto: body.monto,
      fecha: body.fecha,
      notas: body.notas,
    });

    res.status(201).json({
      success: true,
      data,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      logger.warn({ errors: err.errors }, 'POST /financials/registro: validation error');
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
      return;
    }

    const error = err instanceof Error ? err.message : String(err);
    logger.error({ error }, 'POST /financials/registro: error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /analytics/case/:causaId
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetCaseDetail(req: Request, res: Response): Promise<void> {
  try {
    const { causaId } = req.params;

    if (!causaId || typeof causaId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'causaId is required',
      });
      return;
    }

    logger.debug({ causaId }, 'GET /analytics/case/:causaId');

    const data = await getCaseDetail(causaId);

    if (!data) {
      res.status(404).json({
        success: false,
        error: 'Case not found',
      });
      return;
    }

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ error }, 'GET /analytics/case/:causaId: error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
