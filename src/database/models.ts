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

  const { data, error } = await (db.from('conversations') as any).insert([insert]).select().single();

  if (error) {
    if (error.message.includes('duplicate key')) {
      throw new Error(`Conversation for causa_id "${causaId}" already exists.`);
    }
    logger.error({ error: error.message, causaId }, 'createConversation: database error');
    throw error;
  }

  logger.debug({ conversationId, causaId }, 'Conversation created');
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
      updateObj[key] = (updates as any)[key];
    }
  }

  updateObj.updated_at = new Date().toISOString();

  const { data, error } = await (db
    .from('conversations') as any)
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

  const { data, error } = await (db
    .from('conversations') as any)
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

  const { data, error } = await (db.from('messages') as any).insert([insert]).select().single();

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

  const { data, error } = await (db.from('audit_log') as any).insert([insert]).select().single();

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

  const conversationId = (convData as any).id;

  const { data: msgData, error: msgError } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId);

  if (msgError) {
    logger.error({ error: msgError.message, conversationId }, 'getAuditTrailForCase: message lookup error');
    throw msgError;
  }

  const messageIds = ((msgData || []) as any[]).map((m) => m.id);

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
