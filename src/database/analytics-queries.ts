/**
 * analytics-queries.ts
 *
 * Analytics query helpers for portfolio dashboard (Fase 6.3).
 * Separate from models.ts to maintain single responsibility principle.
 */

import { getDb } from './supabase';
import { logger } from '@utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// KPI Queries
// ─────────────────────────────────────────────────────────────────────────────

export interface CartKPI {
  totalCobradoAnio: number;
  cobradoEsteMes: number;
  acuerdosActivos: number;
  cuotasVencidas: number;
  porcentajeResultados: number;
  causasActivas: number;
  causasDesistidas: number;
  causasCaducadas: number;
}

export async function getCartKPI(): Promise<CartKPI> {
  const db = getDb();
  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01`;
  const yearEnd = `${now.getFullYear()}-12-31`;
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

  const { data: registrosAnio, error: registrosAnioError } = await db
    .from('registros')
    .select('monto')
    .gte('fecha', yearStart)
    .lte('fecha', yearEnd);

  if (registrosAnioError) {
    logger.error({ error: registrosAnioError.message }, 'getCartKPI: registros year error');
    throw registrosAnioError;
  }

  const totalCobradoAnio = (registrosAnio as any[] || [])
    .reduce((sum, r) => sum + (r.monto || 0), 0);

  const { data: registrosMes, error: registrosMesError } = await db
    .from('registros')
    .select('monto')
    .gte('fecha', monthStart)
    .lt('fecha', monthEnd);

  if (registrosMesError) {
    logger.error({ error: registrosMesError.message }, 'getCartKPI: registros month error');
    throw registrosMesError;
  }

  const cobradoEsteMes = (registrosMes as any[] || [])
    .reduce((sum, r) => sum + (r.monto || 0), 0);

  const { data: acuerdos, error: acuerdosError } = await db
    .from('acuerdos')
    .select('id')
    .eq('estado', 'activo');

  if (acuerdosError) {
    logger.error({ error: acuerdosError.message }, 'getCartKPI: acuerdos error');
    throw acuerdosError;
  }

  const acuerdosActivos = (acuerdos || []).length;

  const { data: cuotasVencidasData, error: cuotasVencidasError } = await db
    .from('cuotas')
    .select('id')
    .lt('fecha_vencimiento', now.toISOString().split('T')[0])
    .is('fecha_pago', null);

  if (cuotasVencidasError) {
    logger.error({ error: cuotasVencidasError.message }, 'getCartKPI: cuotas vencidas error');
    throw cuotasVencidasError;
  }

  const cuotasVencidas = (cuotasVencidasData || []).length;

  const { data: conversations, error: conversationsError } = await db
    .from('conversations')
    .select('id, case_state');

  if (conversationsError) {
    logger.error({ error: conversationsError.message }, 'getCartKPI: conversations error');
    throw conversationsError;
  }

  const convData = conversations || [];
  const causasActivas = convData.filter((c: any) => c.case_state === 'activo').length;
  const causasDesistidas = convData.filter((c: any) => c.case_state === 'desistido').length;
  const causasCaducadas = convData.filter((c: any) => c.case_state === 'caducado').length;

  const convWithResult = convData.filter((c: any) => c.case_state !== 'activo').length;
  const porcentajeResultados = convData.length > 0
    ? Math.round((convWithResult / convData.length) * 100)
    : 0;

  return {
    totalCobradoAnio,
    cobradoEsteMes,
    acuerdosActivos,
    cuotasVencidas,
    porcentajeResultados,
    causasActivas,
    causasDesistidas,
    causasCaducadas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Income Queries
// ─────────────────────────────────────────────────────────────────────────────

export interface IncomeData {
  porMes: Array<{
    mes: string;
    total: number;
    cobranza: number;
    sentencia: number;
    acuerdo: number;
  }>;
  porFuente: {
    cobranza: number;
    sentencia: number;
    acuerdo: number;
  };
}

export async function getIncomeData(from: string, to: string): Promise<IncomeData> {
  const db = getDb();

  const { data: registros, error } = await db
    .from('registros')
    .select('tipo, monto, fecha')
    .gte('fecha', from)
    .lte('fecha', to);

  if (error) {
    logger.error({ error: error.message }, 'getIncomeData: registros error');
    throw error;
  }

  const byMonth: Record<string, { total: number; cobranza: number; sentencia: number; acuerdo: number }> = {};
  let totalCobranza = 0;
  let totalSentencia = 0;
  let totalAcuerdo = 0;

  for (const reg of registros || []) {
    const mes = (reg as any).fecha.slice(0, 7);
    if (!byMonth[mes]) {
      byMonth[mes] = { total: 0, cobranza: 0, sentencia: 0, acuerdo: 0 };
    }

    const tipo = (reg as any).tipo;
    const monto = (reg as any).monto || 0;

    byMonth[mes].total += monto;

    if (tipo === 'cobranza') {
      byMonth[mes].cobranza += monto;
      totalCobranza += monto;
    } else if (tipo === 'sentencia') {
      byMonth[mes].sentencia += monto;
      totalSentencia += monto;
    } else if (tipo === 'acuerdo') {
      byMonth[mes].acuerdo += monto;
      totalAcuerdo += monto;
    }
  }

  const porMes = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, data]) => ({
      mes,
      ...data,
    }));

  const grandTotal = totalCobranza + totalSentencia + totalAcuerdo;
  const porFuente = {
    cobranza: grandTotal > 0 ? Math.round((totalCobranza / grandTotal) * 100) : 0,
    sentencia: grandTotal > 0 ? Math.round((totalSentencia / grandTotal) * 100) : 0,
    acuerdo: grandTotal > 0 ? Math.round((totalAcuerdo / grandTotal) * 100) : 0,
  };

  return { porMes, porFuente };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agreements Query
// ─────────────────────────────────────────────────────────────────────────────

export interface AcuerdoStatus {
  causaId: string;
  acuerdoId: string;
  montoTotal: number;
  cuotasPagadas: number;
  cuotasTotal: number;
  proximoVencimiento: string | null;
  cuotasVencidas: number;
  estadoGeneral: 'al_dia' | 'con_retraso' | 'vencido';
}

export async function getAcuerdosStatus(): Promise<AcuerdoStatus[]> {
  const db = getDb();

  const { data: acuerdos, error: acuerdosError } = await db
    .from('acuerdos')
    .select('id, conversation_id, monto_total, cuotas_total, estado');

  if (acuerdosError) {
    logger.error({ error: acuerdosError.message }, 'getAcuerdosStatus: acuerdos error');
    throw acuerdosError;
  }

  const result: AcuerdoStatus[] = [];

  for (const acuerdo of acuerdos || []) {
    const { data: conversation } = await db
      .from('conversations')
      .select('causa_id')
      .eq('id', (acuerdo as any).conversation_id)
      .single();

    const { data: cuotas, error: cuotasError } = await db
      .from('cuotas')
      .select('numero, fecha_vencimiento, fecha_pago, estado')
      .eq('acuerdo_id', (acuerdo as any).id)
      .order('numero', { ascending: true });

    if (cuotasError) {
      logger.error({ error: cuotasError.message }, 'getAcuerdosStatus: cuotas error');
      continue;
    }

    const cuotasData = cuotas || [];
    const now = new Date().toISOString().split('T')[0];

    const cuotasPagadas = cuotasData.filter((c: any) => c.fecha_pago !== null).length;
    const cuotasVencidas = cuotasData.filter(
      (c: any) => c.fecha_vencimiento < now && c.fecha_pago === null
    ).length;
    const proximoCuota = cuotasData.find((c: any) => c.fecha_pago === null);
    const proximoVencimiento = proximoCuota ? (proximoCuota as any).fecha_vencimiento : null;

    let estadoGeneral: 'al_dia' | 'con_retraso' | 'vencido' = 'al_dia';
    if (cuotasVencidas > 0) {
      estadoGeneral = 'vencido';
    } else if (cuotasData.some((c: any) => c.estado === 'pagada_con_retraso')) {
      estadoGeneral = 'con_retraso';
    }

    result.push({
      causaId: (conversation as any)?.causa_id || 'unknown',
      acuerdoId: (acuerdo as any).id,
      montoTotal: (acuerdo as any).monto_total,
      cuotasPagadas,
      cuotasTotal: (acuerdo as any).cuotas_total,
      proximoVencimiento,
      cuotasVencidas,
      estadoGeneral,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Case Results Query
// ─────────────────────────────────────────────────────────────────────────────

export interface CaseResults {
  total: number;
  conResultado: number;
  sinResultado: number;
  desistidas: number;
  caducadas: number;
  activas: number;
}

export async function getCaseResults(): Promise<CaseResults> {
  const db = getDb();

  const { data: conversations, error } = await db
    .from('conversations')
    .select('case_state');

  if (error) {
    logger.error({ error: error.message }, 'getCaseResults: error');
    throw error;
  }

  const data = conversations || [];
  const total = data.length;
  const conResultado = data.filter((c: any) => c.case_state !== 'activo').length;
  const sinResultado = data.filter((c: any) => c.case_state === 'activo').length;
  const desistidas = data.filter((c: any) => c.case_state === 'desistido').length;
  const caducadas = data.filter((c: any) => c.case_state === 'caducado').length;
  const activas = sinResultado;

  return { total, conResultado, sinResultado, desistidas, caducadas, activas };
}
