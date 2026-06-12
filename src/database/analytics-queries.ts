/**
 * analytics-queries.ts
 *
 * Analytics query helpers for portfolio dashboard (Fase 6.3).
 * Separate from models.ts to maintain single responsibility principle.
 */

import { getDb } from './supabase';
import { logger } from '@utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase row shapes (client is untyped — query results are cast to these)
// ─────────────────────────────────────────────────────────────────────────────

interface MontoRow {
  monto: number | null;
}

interface ConversationStateRow {
  id?: string;
  case_state: string;
}

interface RegistroIncomeRow {
  tipo: string;
  monto: number | null;
  fecha: string;
}

interface AcuerdoDetailRow {
  id: string;
  monto_total: number;
  cuotas_total: number;
  estado: string;
}

interface AcuerdoRow extends AcuerdoDetailRow {
  conversation_id: string;
}

interface CuotaStatusRow {
  numero: number;
  fecha_vencimiento: string;
  fecha_pago: string | null;
  estado: string;
}

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
  causasPagadas: number;
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

  const totalCobradoAnio = ((registrosAnio || []) as MontoRow[])
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

  const cobradoEsteMes = ((registrosMes || []) as MontoRow[])
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
    .select('id, case_state')
    .neq('causa_id', '__portfolio__');

  if (conversationsError) {
    logger.error({ error: conversationsError.message }, 'getCartKPI: conversations error');
    throw conversationsError;
  }

  const convData = (conversations || []) as ConversationStateRow[];
  const causasActivas = convData.filter((c) => c.case_state === 'activa').length;
  const causasDesistidas = convData.filter((c) => c.case_state === 'desistido').length;
  const causasCaducadas = convData.filter((c) => c.case_state === 'caducado').length;
  const causasPagadas = convData.filter((c) => c.case_state === 'pagado').length;

  const convWithResult = convData.filter((c) => c.case_state !== 'activa').length;
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
    causasPagadas,
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

  for (const reg of (registros || []) as RegistroIncomeRow[]) {
    const mes = reg.fecha.slice(0, 7);
    if (!byMonth[mes]) {
      byMonth[mes] = { total: 0, cobranza: 0, sentencia: 0, acuerdo: 0 };
    }

    const tipo = reg.tipo;
    const monto = reg.monto || 0;

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

  for (const acuerdo of (acuerdos || []) as AcuerdoRow[]) {
    const { data: conversation } = await db
      .from('conversations')
      .select('causa_id')
      .eq('id', acuerdo.conversation_id)
      .single();

    const { data: cuotas, error: cuotasError } = await db
      .from('cuotas')
      .select('numero, fecha_vencimiento, fecha_pago, estado')
      .eq('acuerdo_id', acuerdo.id)
      .order('numero', { ascending: true });

    if (cuotasError) {
      logger.error({ error: cuotasError.message }, 'getAcuerdosStatus: cuotas error');
      continue;
    }

    const cuotasData = (cuotas || []) as CuotaStatusRow[];
    const now = new Date().toISOString().split('T')[0];

    const cuotasPagadas = cuotasData.filter((c) => c.fecha_pago !== null).length;
    const cuotasVencidas = cuotasData.filter(
      (c) => c.fecha_vencimiento < now && c.fecha_pago === null
    ).length;
    const proximoCuota = cuotasData.find((c) => c.fecha_pago === null);
    const proximoVencimiento = proximoCuota ? proximoCuota.fecha_vencimiento : null;

    let estadoGeneral: 'al_dia' | 'con_retraso' | 'vencido' = 'al_dia';
    if (cuotasVencidas > 0) {
      estadoGeneral = 'vencido';
    } else if (cuotasData.some((c) => c.estado === 'pagada_con_retraso')) {
      estadoGeneral = 'con_retraso';
    }

    result.push({
      causaId: (conversation as { causa_id?: string } | null)?.causa_id || 'unknown',
      acuerdoId: acuerdo.id,
      montoTotal: acuerdo.monto_total,
      cuotasPagadas,
      cuotasTotal: acuerdo.cuotas_total,
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
  pagadas: number;
  activas: number;
}

export async function getCaseResults(): Promise<CaseResults> {
  const db = getDb();

  const { data: conversations, error } = await db
    .from('conversations')
    .select('case_state')
    .neq('causa_id', '__portfolio__');

  if (error) {
    logger.error({ error: error.message }, 'getCaseResults: error');
    throw error;
  }

  const data = (conversations || []) as ConversationStateRow[];
  const total = data.length;
  const conResultado = data.filter((c) => c.case_state !== 'activa').length;
  const sinResultado = data.filter((c) => c.case_state === 'activa').length;
  const desistidas = data.filter((c) => c.case_state === 'desistido').length;
  const caducadas = data.filter((c) => c.case_state === 'caducado').length;
  const pagadas = data.filter((c) => c.case_state === 'pagado').length;
  const activas = sinResultado;

  return { total, conResultado, sinResultado, desistidas, caducadas, pagadas, activas };
}

// ─────────────────────────────────────────────────────────────────────────────
// Case Detail Query
// ─────────────────────────────────────────────────────────────────────────────

export interface CaseDetail {
  conversation: {
    id: string;
    causa_id: string;
    cliente_nombre?: string;
    cliente_rut?: string;
    tribunal?: string;
    rit?: string;
    case_state: string;
    ingreso_honorarios: number;
    pagos_pendientes: number;
    created_at: string;
  };
  registros: Array<{ id: string; tipo: string; monto: number; fecha: string; notas?: string; created_at: string }>;
  acuerdos: Array<{
    id: string;
    monto_total: number;
    cuotas_total: number;
    estado: string;
    cuotas: Array<{ numero: number; monto: number; fecha_vencimiento?: string; fecha_pago?: string; estado: string }>;
  }>;
  totales: {
    totalCobranza: number;
    totalHonorarios: number;
    totalGastos: number;
    totalSentencias: number;
  };
}

export async function getCaseDetail(causaId: string): Promise<CaseDetail | null> {
  const db = getDb();

  // 1. Get conversation
  const { data: conversationData, error: convError } = await db
    .from('conversations')
    .select('id, causa_id, cliente_nombre, cliente_rut, tribunal, rit, case_state, ingreso_honorarios, pagos_pendientes, created_at')
    .eq('causa_id', causaId)
    .single();

  if (convError || !conversationData) {
    logger.error({ error: convError?.message, causaId }, 'getCaseDetail: conversation not found');
    return null;
  }

  const conversation = conversationData as unknown as CaseDetail['conversation'];
  const conversationId = conversation.id;

  // 2. Get registros
  const { data: registrosData, error: registrosError } = await db
    .from('registros')
    .select('id, tipo, monto, fecha, notas, created_at')
    .eq('conversation_id', conversationId)
    .order('fecha', { ascending: false });

  if (registrosError) {
    logger.error({ error: registrosError.message }, 'getCaseDetail: registros error');
    throw registrosError;
  }

  const registros = (registrosData || []) as CaseDetail['registros'];

  // 3. Get acuerdos with cuotas
  const { data: acuerdosData, error: acuerdosError } = await db
    .from('acuerdos')
    .select('id, monto_total, cuotas_total, estado')
    .eq('conversation_id', conversationId);

  if (acuerdosError) {
    logger.error({ error: acuerdosError.message }, 'getCaseDetail: acuerdos error');
    throw acuerdosError;
  }

  const acuerdosWithCuotas: CaseDetail['acuerdos'] = [];
  for (const acuerdo of (acuerdosData || []) as AcuerdoDetailRow[]) {
    const { data: cuotasData } = await db
      .from('cuotas')
      .select('numero, monto, fecha_vencimiento, fecha_pago, estado')
      .eq('acuerdo_id', acuerdo.id)
      .order('numero', { ascending: true });

    acuerdosWithCuotas.push({
      ...acuerdo,
      cuotas: (cuotasData || []) as CaseDetail['acuerdos'][number]['cuotas'],
    });
  }

  // 4. Calculate totals by tipo
  const totales = {
    totalCobranza: registros.filter((r) => r.tipo === 'cobranza').reduce((sum, r) => sum + (r.monto || 0), 0),
    totalHonorarios: registros.filter((r) => r.tipo === 'honorarios').reduce((sum, r) => sum + (r.monto || 0), 0),
    totalGastos: registros.filter((r) => r.tipo === 'gasto').reduce((sum, r) => sum + (r.monto || 0), 0),
    totalSentencias: registros.filter((r) => r.tipo === 'sentencia').reduce((sum, r) => sum + (r.monto || 0), 0),
  };

  return {
    conversation,
    registros,
    acuerdos: acuerdosWithCuotas,
    totales,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Digest (Etapa 4.3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CasoPendiente {
  causaId: string;
  clienteNombre: string | null;
  pendingAction: string;
  updatedAt: string;
}

/** Casos activos con una acción proactiva pendiente del agente (ej. preguntar términos de acuerdo). */
export async function getCasosConPendingAction(): Promise<CasoPendiente[]> {
  const db = getDb();

  const { data, error } = await db
    .from('conversations')
    .select('causa_id, cliente_nombre, pending_action, updated_at')
    .not('pending_action', 'is', null)
    .eq('case_state', 'activa')
    .order('updated_at', { ascending: true });

  if (error) {
    logger.error({ error: error.message }, 'getCasosConPendingAction: database error');
    throw error;
  }

  return ((data || []) as Array<{
    causa_id: string;
    cliente_nombre: string | null;
    pending_action: string;
    updated_at: string;
  }>).map((row) => ({
    causaId: row.causa_id,
    clienteNombre: row.cliente_nombre,
    pendingAction: row.pending_action,
    updatedAt: row.updated_at,
  }));
}
