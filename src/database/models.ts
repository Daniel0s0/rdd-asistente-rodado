import { randomUUID } from 'crypto';
import { getDb } from './supabase';
import {
  Conversation,
  ConversationMetadata,
  Message,
  MessageMetadata,
  MessageRole,
  AuditLogEntry,
  AuditAction,
  AuditEntityType,
  AuditChanges,
  AuditMetadata,
} from './schema';
import { logger } from '@utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase write builders (client is untyped — sin tipos generados de la DB,
// .insert()/.update() infieren `never` como payload). Estos shapes estrechos
// modelan exactamente las cadenas usadas en este archivo, sin `any`.
// ─────────────────────────────────────────────────────────────────────────────

interface DbWriteError {
  code?: string;
  message: string;
}

interface DbSingleResult {
  data: unknown;
  error: DbWriteError | null;
}

interface DbManyResult {
  data: unknown[] | null;
  error: DbWriteError | null;
}

interface InsertableTable {
  insert(values: Record<string, unknown>[]): {
    select(): {
      single(): PromiseLike<DbSingleResult>;
    } & PromiseLike<DbManyResult>;
  };
}

interface UpdatableTable {
  update(values: Record<string, unknown>): {
    eq(
      column: string,
      value: string
    ): {
      select(): {
        single(): PromiseLike<DbSingleResult>;
      };
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createConversation(
  causaId: string,
  webhookData: Record<string, unknown>
): Promise<Conversation> {
  const db = getDb();
  const conversationId = randomUUID();

  const insert = {
    id: conversationId,
    causa_id: causaId,
    cliente_nombre: webhookData.cliente_nombre as string | undefined,
    cliente_rut: webhookData.cliente_rut as string | undefined,
    demandado: webhookData.demandado as string | undefined,
    tribunal: webhookData.tribunal as string | undefined,
    rit: webhookData.rit as string | undefined,
    etapa: webhookData.etapa as string | undefined,
    monto_demanda: webhookData.monto_demanda as number | undefined,
    case_state: 'activo',
    ingreso_honorarios: 0,
    pagos_pendientes: 0,
    message_count: 0,
    metadata: {} as ConversationMetadata,
  };

  const { data, error } = await (db.from('conversations') as unknown as InsertableTable)
    .insert([insert])
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation (Postgres); más robusto que string matching del mensaje
    if (error.code === '23505' || error.message.includes('duplicate key')) {
      throw new Error(`Conversation for causa_id "${causaId}" already exists.`);
    }
    logger.error({ error: error.message, causaId }, 'createConversation: database error');
    throw error;
  }

  logger.debug({ conversationId, causaId }, 'Conversation created');
  return data as Conversation;
}

/** Create a conversation without case data (for portfolio chat and system conversations) */
export async function createSimpleConversation(
  causaId: string
): Promise<Conversation> {
  const db = getDb();
  const conversationId = randomUUID();

  const insert = {
    id: conversationId,
    causa_id: causaId,
    case_state: 'activo',
    ingreso_honorarios: 0,
    pagos_pendientes: 0,
    message_count: 0,
    metadata: {} as ConversationMetadata,
  };

  const { data, error } = await (db.from('conversations') as unknown as InsertableTable)
    .insert([insert])
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation (Postgres); más robusto que string matching del mensaje
    if (error.code === '23505' || error.message.includes('duplicate key')) {
      throw new Error(`Conversation for causa_id "${causaId}" already exists.`);
    }
    logger.error({ error: error.message, causaId }, 'createSimpleConversation: database error');
    throw error;
  }

  logger.debug({ conversationId, causaId }, 'Simple conversation created');
  return data as Conversation;
}

export async function getConversationByCausaId(causaId: string): Promise<Conversation | null> {
  const db = getDb();

  const { data, error } = await db
    .from('conversations')
    .select('*')
    .eq('causa_id', causaId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error({ error: error.message, causaId }, 'getConversationByCausaId: database error');
    throw error;
  }

  if (!data) {
    logger.debug({ causaId }, 'getConversationByCausaId: not found');
    return null;
  }

  return data as Conversation;
}

export async function updateConversationMetadata(
  conversationId: string,
  updates: Partial<Conversation>
): Promise<Conversation> {
  const db = getDb();

  const updateObj: Record<string, unknown> = {};

  for (const key of Object.keys(updates)) {
    if (key !== 'id' && key !== 'created_at') {
      updateObj[key] = updates[key as keyof Conversation];
    }
  }

  updateObj.updated_at = new Date().toISOString();

  const { data, error } = await (db.from('conversations') as unknown as UpdatableTable)
    .update(updateObj)
    .eq('id', conversationId)
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message, conversationId }, 'updateConversationMetadata: database error');
    throw error;
  }

  if (!data) {
    throw new Error(`Conversation "${conversationId}" not found.`);
  }

  logger.debug({ conversationId, updates }, 'Conversation updated');
  return data as Conversation;
}

export async function closeConversation(
  conversationId: string,
  _userId: string
): Promise<Conversation> {
  const db = getDb();

  const { data, error } = await (db.from('conversations') as unknown as UpdatableTable)
    .update({ closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message, conversationId }, 'closeConversation: database error');
    throw error;
  }

  if (!data) {
    throw new Error(`Conversation "${conversationId}" not found.`);
  }

  logger.debug({ conversationId }, 'Conversation closed');
  return data as Conversation;
}

export async function listConversations(options?: {
  onlyOpen?: boolean;
  limit?: number;
  offset?: number;
  q?: string;
  tribunal?: string;
  etapa?: string;
  case_state?: string;
  from?: string;
  to?: string;
}): Promise<Conversation[]> {
  const db = getDb();
  const { onlyOpen = false, limit = 50, offset = 0 } = options ?? {};

  let query = db.from('conversations').select('*');

  if (onlyOpen) {
    query = query.is('closed_at', null);
  }

  if (options?.q) {
    const searchTerm = `%${options.q}%`;
    query = query.or(
      `cliente_nombre.ilike.${searchTerm},demandado.ilike.${searchTerm},rit.ilike.${searchTerm},tribunal.ilike.${searchTerm},causa_id.ilike.${searchTerm}`
    );
  }

  if (options?.tribunal) {
    query = query.eq('tribunal', options.tribunal);
  }

  if (options?.case_state) {
    query = query.eq('case_state', options.case_state);
  }

  if (options?.etapa) {
    query = query.eq('etapa', options.etapa);
  }

  if (options?.from) {
    query = query.gte('created_at', options.from);
  }

  if (options?.to) {
    query = query.lte('created_at', options.to);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error({ error: error.message }, 'listConversations: database error');
    throw error;
  }

  return (data || []) as Conversation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Message CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  metadata?: MessageMetadata
): Promise<Message> {
  const db = getDb();
  const messageId = randomUUID();
  const safeMetadata = metadata ?? {};

  const insert = {
    id: messageId,
    conversation_id: conversationId,
    role,
    content,
    metadata: safeMetadata,
  };

  const { data, error } = await (db.from('messages') as unknown as InsertableTable)
    .insert([insert])
    .select()
    .single();

  if (error) {
    if (error.message.includes('foreign key')) {
      throw new Error(`Conversation "${conversationId}" does not exist. Cannot create message.`);
    }
    logger.error({ error: error.message, conversationId, role }, 'createMessage: database error');
    throw error;
  }

  logger.debug({ messageId, conversationId, role }, 'Message created');
  return data as Message;
}

export async function getConversationHistory(conversationId: string): Promise<Message[]> {
  const db = getDb();

  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error: error.message, conversationId }, 'getConversationHistory: database error');
    throw error;
  }

  logger.debug({ conversationId, count: (data || []).length }, 'getConversationHistory: rows returned');
  return (data || []) as Message[];
}

export async function getRecentMessages(
  conversationId: string,
  limit: number = 20
): Promise<Message[]> {
  const db = getDb();

  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ error: error.message, conversationId }, 'getRecentMessages: database error');
    throw error;
  }

  const rows = (data || []) as Message[];
  return rows.reverse();
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log (Append-Only)
// ─────────────────────────────────────────────────────────────────────────────

export async function createAuditLogEntry(
  entityType: AuditEntityType,
  entityId: string,
  action: AuditAction,
  userId: string,
  changes: AuditChanges,
  metadata?: AuditMetadata
): Promise<AuditLogEntry> {
  const db = getDb();
  const auditId = randomUUID();
  const safeMetadata = metadata ?? {};

  const insert = {
    id: auditId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    user_id: userId,
    changes,
    metadata: safeMetadata,
  };

  const { data, error } = await (db.from('audit_log') as unknown as InsertableTable)
    .insert([insert])
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message, entityType, entityId, action }, 'createAuditLogEntry: database error');
    throw error;
  }

  logger.debug({ auditId, entityType, entityId, action }, 'Audit log entry created');
  return data as AuditLogEntry;
}

export async function getAuditTrail(entityId: string): Promise<AuditLogEntry[]> {
  const db = getDb();

  const { data, error } = await db
    .from('audit_log')
    .select('*')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error: error.message, entityId }, 'getAuditTrail: database error');
    throw error;
  }

  logger.debug({ entityId, count: (data || []).length }, 'getAuditTrail: entries returned');
  return (data || []) as AuditLogEntry[];
}

export async function getAuditTrailForCase(causaId: string): Promise<AuditLogEntry[]> {
  const db = getDb();

  const { data: convData, error: convError } = await db
    .from('conversations')
    .select('id')
    .eq('causa_id', causaId)
    .single();

  if (convError && convError.code !== 'PGRST116') {
    logger.error({ error: convError.message, causaId }, 'getAuditTrailForCase: conversation lookup error');
    throw convError;
  }

  if (!convData) {
    logger.debug({ causaId }, 'getAuditTrailForCase: conversation not found');
    return [];
  }

  const conversationId = (convData as { id: string }).id;

  const { data: msgData, error: msgError } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId);

  if (msgError) {
    logger.error({ error: msgError.message, conversationId }, 'getAuditTrailForCase: message lookup error');
    throw msgError;
  }

  const messageIds = ((msgData || []) as Array<{ id: string }>).map((m) => m.id);

  const entityIds = [conversationId, ...messageIds];

  const { data: auditData, error: auditError } = await db
    .from('audit_log')
    .select('*')
    .in('entity_id', entityIds)
    .order('created_at', { ascending: false });

  if (auditError) {
    logger.error({ error: auditError.message, causaId }, 'getAuditTrailForCase: audit lookup error');
    throw auditError;
  }

  logger.debug({ causaId, conversationId, count: (auditData || []).length }, 'getAuditTrailForCase: entries returned');
  return (auditData || []) as AuditLogEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Data (Fase 6.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface AcuerdoRecord {
  id: string;
  conversation_id: string;
  monto_total: number;
  cuotas_total: number;
  monto_por_cuota: number;
  porcentaje_honorarios: number;
  fecha_primer_pago: string;
  estado: 'activo' | 'completado' | 'incumplido';
  created_at: string;
}

export interface CuotaRecord {
  id: string;
  acuerdo_id: string;
  numero: number;
  monto: number;
  fecha_vencimiento: string;
  fecha_pago: string | null;
  estado: 'pendiente' | 'pagada' | 'vencida' | 'pagada_con_retraso';
  created_at: string;
}

export interface RegistroRecord {
  id: string;
  conversation_id: string;
  tipo: 'cobranza' | 'sentencia' | 'gasto' | 'honorarios';
  monto: number;
  fecha: string;
  notas: string | null;
  created_at: string;
}

export async function createAcuerdo(data: {
  conversationId: string;
  montoTotal: number;
  cuotasTotal: number;
  montoPorCuota: number;
  porcentajeHonorarios: number;
  fechaPrimerPago: string;
}): Promise<AcuerdoRecord> {
  const db = getDb();
  const acuerdoId = randomUUID();

  const insert = {
    id: acuerdoId,
    conversation_id: data.conversationId,
    monto_total: data.montoTotal,
    cuotas_total: data.cuotasTotal,
    monto_por_cuota: data.montoPorCuota,
    porcentaje_honorarios: data.porcentajeHonorarios,
    fecha_primer_pago: data.fechaPrimerPago,
    estado: 'activo',
  };

  const { data: result, error } = await (db.from('acuerdos') as unknown as InsertableTable)
    .insert([insert])
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message, conversationId: data.conversationId }, 'createAcuerdo: database error');
    throw error;
  }

  logger.debug({ acuerdoId, conversationId: data.conversationId }, 'Acuerdo created');
  return result as AcuerdoRecord;
}

export async function createCuotas(acuerdoId: string, cuotas: Array<{ numero: number; monto: number; fechaVencimiento: string }>): Promise<CuotaRecord[]> {
  const db = getDb();

  const inserts = cuotas.map((cuota) => ({
    id: randomUUID(),
    acuerdo_id: acuerdoId,
    numero: cuota.numero,
    monto: cuota.monto,
    fecha_vencimiento: cuota.fechaVencimiento,
    estado: 'pendiente',
  }));

  const { data: result, error } = await (db.from('cuotas') as unknown as InsertableTable)
    .insert(inserts)
    .select();

  if (error) {
    logger.error({ error: error.message, acuerdoId }, 'createCuotas: database error');
    throw error;
  }

  logger.debug({ acuerdoId, count: (result || []).length }, 'Cuotas created');
  return (result || []) as CuotaRecord[];
}

export async function createRegistro(data: {
  conversationId: string;
  tipo: 'cobranza' | 'sentencia' | 'gasto' | 'honorarios';
  monto: number;
  fecha: string;
  notas?: string;
}): Promise<RegistroRecord> {
  const db = getDb();
  const registroId = randomUUID();

  const insert = {
    id: registroId,
    conversation_id: data.conversationId,
    tipo: data.tipo,
    monto: data.monto,
    fecha: data.fecha,
    notas: data.notas ?? null,
  };

  const { data: result, error } = await (db.from('registros') as unknown as InsertableTable)
    .insert([insert])
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message, conversationId: data.conversationId }, 'createRegistro: database error');
    throw error;
  }

  logger.debug({ registroId, conversationId: data.conversationId }, 'Registro created');
  return result as RegistroRecord;
}

export async function markCuotaPagada(
  acuerdoId: string,
  numeroCuota: number,
  fechaPago: string
): Promise<CuotaRecord | null> {
  const db = getDb();

  const { data: cuota, error: selectError } = await db
    .from('cuotas')
    .select('*')
    .eq('acuerdo_id', acuerdoId)
    .eq('numero', numeroCuota)
    .single();

  if (selectError && selectError.code !== 'PGRST116') {
    logger.error({ error: selectError.message, acuerdoId, numeroCuota }, 'markCuotaPagada: select error');
    throw selectError;
  }

  if (!cuota) {
    logger.debug({ acuerdoId, numeroCuota }, 'markCuotaPagada: cuota not found');
    return null;
  }

  const fechaPagoDate = new Date(fechaPago);
  const fechaVencimientoDate = new Date((cuota as CuotaRecord).fecha_vencimiento);
  const diffDays = Math.floor((fechaPagoDate.getTime() - fechaVencimientoDate.getTime()) / (1000 * 60 * 60 * 24));

  const newEstado = diffDays > 5 ? 'pagada_con_retraso' : 'pagada';

  const { data: result, error: updateError } = await (db.from('cuotas') as unknown as UpdatableTable)
    .update({
      fecha_pago: fechaPago,
      estado: newEstado,
    })
    .eq('id', (cuota as CuotaRecord).id)
    .select()
    .single();

  if (updateError) {
    logger.error({ error: updateError.message, acuerdoId, numeroCuota }, 'markCuotaPagada: update error');
    throw updateError;
  }

  logger.debug({ acuerdoId, numeroCuota, estado: newEstado }, 'Cuota marked as paid');
  return result as CuotaRecord;
}

export async function getAcuerdosActivos(conversationId: string): Promise<AcuerdoRecord[]> {
  const db = getDb();

  const { data, error } = await db
    .from('acuerdos')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('estado', 'activo')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error: error.message, conversationId }, 'getAcuerdosActivos: database error');
    throw error;
  }

  logger.debug({ conversationId, count: (data || []).length }, 'getAcuerdosActivos: rows returned');
  return (data || []) as AcuerdoRecord[];
}
