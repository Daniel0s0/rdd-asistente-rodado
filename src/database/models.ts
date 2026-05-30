/**
 * models.ts — RDD Database CRUD Operations
 *
 * Implements all CRUD functions for:
 *   - conversations: one thread per legal case (causa_id)
 *   - messages: individual turns in each conversation
 *   - audit_log: append-only change trail
 *
 * All write operations that touch multiple tables are wrapped in
 * better-sqlite3 synchronous transactions for atomicity.
 *
 * Timestamps are managed by SQLite DEFAULT CURRENT_TIMESTAMP.
 * UUIDs are generated via Node.js built-in crypto.randomUUID().
 * JSON metadata is always serialized/deserialized at the boundary.
 */

import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
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
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw row shape returned by better-sqlite3 for the conversations table.
 * SQLite returns timestamps as strings; we parse them to Date on the way out.
 */
interface ConversationRow {
  id: string;
  causa_id: string;
  metadata: string;           // JSON blob
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

/**
 * Raw row shape returned by better-sqlite3 for the messages table.
 */
interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: string;           // JSON blob
  created_at: string;
}

/**
 * Raw row shape returned by better-sqlite3 for the audit_log table.
 */
interface AuditLogRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  user_id: string;
  changes: string;            // JSON blob
  metadata: string;           // JSON blob
  created_at: string;
}

/** Deserialize a raw DB row into a typed Conversation. */
function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    causa_id: row.causa_id,
    metadata: JSON.parse(row.metadata) as ConversationMetadata,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    closed_at: row.closed_at ? new Date(row.closed_at) : null,
  };
}

/** Deserialize a raw DB row into a typed Message. */
function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    metadata: JSON.parse(row.metadata) as MessageMetadata,
    created_at: new Date(row.created_at),
  };
}

/** Deserialize a raw DB row into a typed AuditLogEntry. */
function rowToAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    entity_type: row.entity_type as AuditEntityType,
    entity_id: row.entity_id,
    action: row.action as AuditAction,
    user_id: row.user_id,
    changes: JSON.parse(row.changes) as AuditChanges,
    metadata: JSON.parse(row.metadata) as AuditMetadata,
    created_at: new Date(row.created_at),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new conversation from a webhook payload.
 *
 * Atomically inserts the conversation row and an audit log entry.
 * Throws if a conversation for `causaId` already exists (UNIQUE constraint).
 *
 * @param causaId     - Case ID from the webhook (e.g., "2024-00123").
 * @param webhookData - Webhook payload; used to populate initial metadata.
 * @returns The newly created Conversation.
 */
export async function createConversation(
  causaId: string,
  webhookData: Record<string, unknown>
): Promise<Conversation> {
  const db = getDatabase();
  const conversationId = randomUUID();

  // Build initial metadata from webhook payload fields we care about.
  const initialMetadata: ConversationMetadata = {
    demandado: typeof webhookData.demandado === 'string' ? webhookData.demandado : undefined,
    monto_demanda: typeof webhookData.monto_demanda === 'number' ? webhookData.monto_demanda : undefined,
    tribunal: typeof webhookData.tribunal === 'string' ? webhookData.tribunal : undefined,
    rit: typeof webhookData.rit === 'string' ? webhookData.rit : undefined,
    etapa: typeof webhookData.etapa === 'string' ? webhookData.etapa : undefined,
    message_count: 0,
  };

  const auditId = randomUUID();

  try {
    db.transaction(() => {
      // Insert conversation row.
      db.prepare(`
        INSERT INTO conversations (id, causa_id, metadata, created_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(conversationId, causaId, JSON.stringify(initialMetadata));

      // Audit log — immutable record of the creation.
      db.prepare(`
        INSERT INTO audit_log (id, entity_type, entity_id, action, user_id, changes, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        auditId,
        'conversation',
        conversationId,
        'CREATE',
        'webhook_sistema',
        JSON.stringify({ id: { before: null, after: conversationId }, causa_id: { before: null, after: causaId } }),
        JSON.stringify({ trigger: 'webhook', webhook_type: 'CREACION' })
      );
    })();
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: string };
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`Conversation for causa_id "${causaId}" already exists.`);
    }
    logger.error({ error: err.message, causaId }, 'createConversation: database error');
    throw error;
  }

  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as ConversationRow;
  const conversation = rowToConversation(row);

  logger.debug({ conversationId, causaId }, 'Conversation created');
  return conversation;
}

/**
 * Find a conversation by its case ID.
 *
 * Uses the idx_conversations_causa_id index for fast lookup.
 *
 * @param causaId - Case ID (e.g., "2024-00123").
 * @returns The matching Conversation, or null if not found.
 */
export async function getConversationByCausaId(causaId: string): Promise<Conversation | null> {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM conversations WHERE causa_id = ?')
    .get(causaId) as ConversationRow | undefined;

  if (!row) {
    logger.debug({ causaId }, 'getConversationByCausaId: not found');
    return null;
  }

  return rowToConversation(row);
}

/**
 * Merge `updates` into the existing metadata of a conversation.
 *
 * Atomically reads the current metadata, merges the updates, persists,
 * and writes an audit log entry with before/after values.
 *
 * @param conversationId - ID of the conversation to update.
 * @param updates        - Partial metadata fields to merge in.
 * @returns The updated Conversation.
 */
export async function updateConversationMetadata(
  conversationId: string,
  updates: Partial<ConversationMetadata>
): Promise<Conversation> {
  const db = getDatabase();

  // Read current row first (outside transaction — read-only).
  const existing = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(conversationId) as ConversationRow | undefined;

  if (!existing) {
    throw new Error(`Conversation "${conversationId}" not found.`);
  }

  const previousMetadata: ConversationMetadata = JSON.parse(existing.metadata);
  const newMetadata: ConversationMetadata = { ...previousMetadata, ...updates };

  const auditId = randomUUID();
  const auditChanges: AuditChanges = {};

  // Record only the fields that actually changed.
  for (const key of Object.keys(updates) as Array<keyof ConversationMetadata>) {
    auditChanges[`metadata.${key}`] = {
      before: previousMetadata[key] ?? null,
      after: newMetadata[key] ?? null,
    };
  }

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE conversations
        SET metadata = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify(newMetadata), conversationId);

      db.prepare(`
        INSERT INTO audit_log (id, entity_type, entity_id, action, user_id, changes, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        auditId,
        'conversation',
        conversationId,
        'UPDATE',
        'webhook_sistema',
        JSON.stringify(auditChanges),
        JSON.stringify({ trigger: 'system' })
      );
    })();
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, conversationId }, 'updateConversationMetadata: database error');
    throw error;
  }

  const updated = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(conversationId) as ConversationRow;

  logger.debug({ conversationId, updates }, 'Conversation metadata updated');
  return rowToConversation(updated);
}

/**
 * Close a conversation (case finalized).
 *
 * Sets closed_at to the current timestamp and writes an audit entry.
 * Idempotent if called twice, though the audit log will record each call.
 *
 * @param conversationId - ID of the conversation to close.
 * @param userId         - Who is closing the conversation.
 * @returns The updated Conversation with closed_at set.
 */
export async function closeConversation(
  conversationId: string,
  userId: string
): Promise<Conversation> {
  const db = getDatabase();

  const existing = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(conversationId) as ConversationRow | undefined;

  if (!existing) {
    throw new Error(`Conversation "${conversationId}" not found.`);
  }

  const auditId = randomUUID();

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE conversations
        SET closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(conversationId);

      db.prepare(`
        INSERT INTO audit_log (id, entity_type, entity_id, action, user_id, changes, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        auditId,
        'conversation',
        conversationId,
        'CLOSE',
        userId,
        JSON.stringify({ closed_at: { before: existing.closed_at ?? null, after: 'CURRENT_TIMESTAMP' } }),
        JSON.stringify({ trigger: 'webhook', webhook_type: 'CIERRE' })
      );
    })();
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, conversationId, userId }, 'closeConversation: database error');
    throw error;
  }

  const closed = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(conversationId) as ConversationRow;

  logger.debug({ conversationId, userId }, 'Conversation closed');
  return rowToConversation(closed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Message CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a message to an existing conversation.
 *
 * Atomically inserts the message row and an audit log entry.
 * Throws if `conversationId` does not exist (FOREIGN KEY violation).
 *
 * @param conversationId - Which conversation this message belongs to.
 * @param role           - 'user' or 'assistant'.
 * @param content        - Message text.
 * @param metadata       - Optional parsed intent or response strategy.
 * @returns The newly created Message.
 */
export async function createMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  metadata?: MessageMetadata
): Promise<Message> {
  const db = getDatabase();
  const messageId = randomUUID();
  const safeMetadata: MessageMetadata = metadata ?? {};
  const auditId = randomUUID();

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(messageId, conversationId, role, content, JSON.stringify(safeMetadata));

      db.prepare(`
        INSERT INTO audit_log (id, entity_type, entity_id, action, user_id, changes, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        auditId,
        'message',
        messageId,
        'CREATE',
        role === 'user' ? 'manual_user' : 'webhook_sistema',
        JSON.stringify({
          id: { before: null, after: messageId },
          conversation_id: { before: null, after: conversationId },
          role: { before: null, after: role },
          content: { before: null, after: content },
        }),
        JSON.stringify({ trigger: role === 'user' ? 'manual_user' : 'system' })
      );
    })();
  } catch (error) {
    const err = error as Error;
    if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
      throw new Error(`Conversation "${conversationId}" does not exist. Cannot create message.`);
    }
    logger.error({ error: err.message, conversationId, role }, 'createMessage: database error');
    throw error;
  }

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRow;

  logger.debug({ messageId, conversationId, role }, 'Message created');
  return rowToMessage(row);
}

/**
 * Load the full message history for a conversation in chronological order.
 *
 * Uses the idx_messages_conversation_created composite index.
 *
 * @param conversationId - Which conversation to load.
 * @returns All messages ordered by created_at ASC (oldest first).
 */
export async function getConversationHistory(conversationId: string): Promise<Message[]> {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `)
    .all(conversationId) as MessageRow[];

  logger.debug({ conversationId, count: rows.length }, 'getConversationHistory: rows returned');
  return rows.map(rowToMessage);
}

/**
 * Load the N most recent messages, returned in chronological order.
 *
 * Fetches DESC (newest first) then reverses, so callers receive
 * the last `limit` messages oldest-first — ready for Claude SDK.
 *
 * @param conversationId - Which conversation to query.
 * @param limit          - Maximum number of messages to return (default 20).
 * @returns Up to `limit` messages ordered by created_at ASC.
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 20
): Promise<Message[]> {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(conversationId, limit) as MessageRow[];

  // Reverse to restore chronological (oldest-first) order.
  return rows.reverse().map(rowToMessage);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log (Append-Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append an entry to the audit log.
 *
 * No transaction is needed — the audit log is immutable and append-only.
 * This function can be called directly for ad-hoc audit needs; most
 * write operations call it implicitly via their own transactions.
 *
 * @param entityType - 'conversation' or 'message'.
 * @param entityId   - ID of the entity that changed.
 * @param action     - 'CREATE', 'UPDATE', or 'CLOSE'.
 * @param userId     - Who triggered the change.
 * @param changes    - Before/after values for each modified field.
 * @param metadata   - Optional context (trigger, IP, notes).
 * @returns The created AuditLogEntry.
 */
export async function createAuditLogEntry(
  entityType: AuditEntityType,
  entityId: string,
  action: AuditAction,
  userId: string,
  changes: AuditChanges,
  metadata?: AuditMetadata
): Promise<AuditLogEntry> {
  const db = getDatabase();
  const auditId = randomUUID();
  const safeMetadata: AuditMetadata = metadata ?? {};

  try {
    db.prepare(`
      INSERT INTO audit_log (id, entity_type, entity_id, action, user_id, changes, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      auditId,
      entityType,
      entityId,
      action,
      userId,
      JSON.stringify(changes),
      JSON.stringify(safeMetadata)
    );
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, entityType, entityId, action }, 'createAuditLogEntry: database error');
    throw error;
  }

  const row = db
    .prepare('SELECT * FROM audit_log WHERE id = ?')
    .get(auditId) as AuditLogRow;

  return rowToAuditLogEntry(row);
}

/**
 * Retrieve all audit entries for a given entity, newest first.
 *
 * Uses the idx_audit_log_entity_id index.
 *
 * @param entityId - ID of the conversation or message to query.
 * @returns All matching audit entries ordered by created_at DESC.
 */
export async function getAuditTrail(entityId: string): Promise<AuditLogEntry[]> {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM audit_log
      WHERE entity_id = ?
      ORDER BY created_at DESC
    `)
    .all(entityId) as AuditLogRow[];

  logger.debug({ entityId, count: rows.length }, 'getAuditTrail: rows returned');
  return rows.map(rowToAuditLogEntry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the complete audit trail for a legal case, combining all changes
 * to the conversation and every message within it.
 *
 * Sorted by created_at DESC (newest first) across all entity types.
 *
 * @param causaId - Case ID (e.g., "2024-00123").
 * @returns All audit entries for the case, or [] if the case is not found.
 */
export async function getAuditTrailForCase(causaId: string): Promise<AuditLogEntry[]> {
  const db = getDatabase();

  // 1. Find the conversation for this case.
  const convRow = db
    .prepare('SELECT id FROM conversations WHERE causa_id = ?')
    .get(causaId) as { id: string } | undefined;

  if (!convRow) {
    logger.debug({ causaId }, 'getAuditTrailForCase: conversation not found');
    return [];
  }

  const conversationId = convRow.id;

  // 2. Audit entries for the conversation itself.
  const conversationAuditRows = db
    .prepare(`
      SELECT * FROM audit_log
      WHERE entity_id = ?
      ORDER BY created_at DESC
    `)
    .all(conversationId) as AuditLogRow[];

  // 3. All message IDs belonging to this conversation.
  const messageIdRows = db
    .prepare('SELECT id FROM messages WHERE conversation_id = ?')
    .all(conversationId) as { id: string }[];

  // 4. Audit entries for each message.
  const messageAuditRows: AuditLogRow[] = [];
  for (const msg of messageIdRows) {
    const rows = db
      .prepare(`
        SELECT * FROM audit_log
        WHERE entity_id = ?
        ORDER BY created_at DESC
      `)
      .all(msg.id) as AuditLogRow[];
    messageAuditRows.push(...rows);
  }

  // 5. Combine, deserialize, and sort by timestamp descending.
  const allEntries = [
    ...conversationAuditRows.map(rowToAuditLogEntry),
    ...messageAuditRows.map(rowToAuditLogEntry),
  ];

  allEntries.sort(
    (a, b) => b.created_at.getTime() - a.created_at.getTime()
  );

  logger.debug({ causaId, conversationId, count: allEntries.length }, 'getAuditTrailForCase: entries returned');
  return allEntries;
}
