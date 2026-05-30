/**
 * models.test.ts — RDD Database CRUD Integration Tests
 *
 * Strategy:
 *   - Spin up a fresh in-memory SQLite database before each test.
 *   - Mock `getDatabase` (from @database/sqlite) to return the test DB.
 *   - Verify every CRUD function against real SQL — no fake data paths.
 *
 * All 10 public functions are covered:
 *   createConversation, getConversationByCausaId, updateConversationMetadata,
 *   closeConversation, createMessage, getConversationHistory, getRecentMessages,
 *   createAuditLogEntry, getAuditTrail, getAuditTrailForCase
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { FULL_SCHEMA } from '@database/schema';

// ─── Mock getDatabase BEFORE importing models ─────────────────────────────────
// Vitest hoists vi.mock() calls, so this mock is in effect when models.ts loads.
vi.mock('@database/sqlite', () => ({
  getDatabase: vi.fn(),
}));

// Now import models (they will use the mocked getDatabase).
import * as models from '@database/models';
import { getDatabase } from '@database/sqlite';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fresh in-memory DB with the full production schema. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(FULL_SCHEMA);
  return db;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Database CRUD Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // Each test gets its own isolated DB instance.
    vi.mocked(getDatabase).mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  // ─── Conversation CRUD ──────────────────────────────────────────────────────

  describe('Conversation CRUD', () => {
    it('creates conversation with webhook data', async () => {
      const causaId = '2024-00123';
      const webhookData = {
        demandado: 'Juan García',
        monto_demanda: 2500000,
        tribunal: 'Juzgado Civil de Santiago',
        rit: 'RIT-2024-001',
      };

      const conversation = await models.createConversation(causaId, webhookData);

      // Conversation structure
      expect(conversation.id).toBeTruthy();
      expect(conversation.causa_id).toBe(causaId);
      expect(conversation.closed_at).toBeNull();
      expect(conversation.created_at).toBeInstanceOf(Date);
      expect(conversation.updated_at).toBeInstanceOf(Date);

      // Metadata from webhook
      expect(conversation.metadata.demandado).toBe('Juan García');
      expect(conversation.metadata.monto_demanda).toBe(2500000);
      expect(conversation.metadata.tribunal).toBe('Juzgado Civil de Santiago');
      expect(conversation.metadata.rit).toBe('RIT-2024-001');
      expect(conversation.metadata.message_count).toBe(0);

      // Row exists in DB
      const row = db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get(conversation.id) as { causa_id: string; metadata: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.causa_id).toBe(causaId);
      const meta = JSON.parse(row!.metadata);
      expect(meta.demandado).toBe('Juan García');
      expect(meta.monto_demanda).toBe(2500000);

      // Audit log entry created
      const auditRow = db
        .prepare("SELECT * FROM audit_log WHERE entity_id = ? AND action = 'CREATE'")
        .get(conversation.id) as { action: string; entity_type: string } | undefined;
      expect(auditRow).toBeDefined();
      expect(auditRow!.action).toBe('CREATE');
      expect(auditRow!.entity_type).toBe('conversation');
    });

    it('rejects duplicate causa_id', async () => {
      const causaId = '2024-00456';

      await models.createConversation(causaId, { demandado: 'Primer Demandado' });

      await expect(
        models.createConversation(causaId, { demandado: 'Segundo Demandado' })
      ).rejects.toThrow('already exists');
    });

    it('finds conversation by causa_id', async () => {
      const causaId = '2024-00789';
      const created = await models.createConversation(causaId, {
        demandado: 'María López',
        monto_demanda: 1000000,
      });

      const found = await models.getConversationByCausaId(causaId);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.causa_id).toBe(causaId);
      expect(found!.metadata.demandado).toBe('María López');
      expect(found!.metadata.monto_demanda).toBe(1000000);
      expect(found!.created_at).toBeInstanceOf(Date);
    });

    it('returns null for non-existent causa_id', async () => {
      const result = await models.getConversationByCausaId('nonexistent-causa');
      expect(result).toBeNull();
    });

    it('merges metadata and creates audit entry for update', async () => {
      const causaId = '2024-01000';
      const conv = await models.createConversation(causaId, { demandado: 'X' });

      // Capture updated_at before update
      const beforeUpdatedAt = conv.updated_at;

      // Small sleep so SQLite CURRENT_TIMESTAMP can differ (1s resolution).
      // Better-sqlite3 uses wall clock — in :memory: same second is possible,
      // so we test field merging + audit, not timestamp difference.
      const updated = await models.updateConversationMetadata(conv.id, {
        acuerdo_monto: 1800000,
      });

      // Both original and new fields are present
      expect(updated.metadata.demandado).toBe('X');
      expect(updated.metadata.acuerdo_monto).toBe(1800000);

      // Audit entry for UPDATE
      const auditRows = db
        .prepare("SELECT * FROM audit_log WHERE entity_id = ? AND action = 'UPDATE'")
        .all(conv.id) as Array<{ action: string; changes: string }>;
      expect(auditRows.length).toBeGreaterThanOrEqual(1);

      const latestAudit = auditRows[auditRows.length - 1];
      const changes = JSON.parse(latestAudit.changes);
      expect(changes['metadata.acuerdo_monto']).toBeDefined();
      expect(changes['metadata.acuerdo_monto'].before).toBeNull();
      expect(changes['metadata.acuerdo_monto'].after).toBe(1800000);
    });

    it('sets closed_at and creates CLOSE audit entry', async () => {
      const causaId = '2024-02000';
      const conv = await models.createConversation(causaId, { demandado: 'Pedro' });

      const closed = await models.closeConversation(conv.id, 'admin_user123');

      expect(closed.closed_at).not.toBeNull();
      expect(closed.closed_at).toBeInstanceOf(Date);

      // Audit entry with action CLOSE
      const auditRow = db
        .prepare("SELECT * FROM audit_log WHERE entity_id = ? AND action = 'CLOSE'")
        .get(conv.id) as { action: string; user_id: string } | undefined;
      expect(auditRow).toBeDefined();
      expect(auditRow!.action).toBe('CLOSE');
      expect(auditRow!.user_id).toBe('admin_user123');
    });
  });

  // ─── Message CRUD ───────────────────────────────────────────────────────────

  describe('Message CRUD', () => {
    it('stores user message with metadata', async () => {
      const conv = await models.createConversation('2024-03000', {});
      const content = 'Tenemos acuerdo de $1.8M en 5 cuotas';
      const metadata = {
        intent: 'acuerdo' as const,
        monto_extraido: 1800000,
        cuotas_extraido: 5,
      };

      const msg = await models.createMessage(conv.id, 'user', content, metadata);

      expect(msg.id).toBeTruthy();
      expect(msg.conversation_id).toBe(conv.id);
      expect(msg.role).toBe('user');
      expect(msg.content).toBe(content);
      expect(msg.metadata.intent).toBe('acuerdo');
      expect(msg.metadata.monto_extraido).toBe(1800000);
      expect(msg.metadata.cuotas_extraido).toBe(5);
      expect(msg.created_at).toBeInstanceOf(Date);

      // Row persisted in DB
      const row = db
        .prepare('SELECT * FROM messages WHERE id = ?')
        .get(msg.id) as { role: string; metadata: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.role).toBe('user');

      // Audit log entry created
      const auditRow = db
        .prepare("SELECT * FROM audit_log WHERE entity_id = ? AND action = 'CREATE'")
        .get(msg.id) as { action: string; entity_type: string } | undefined;
      expect(auditRow).toBeDefined();
      expect(auditRow!.action).toBe('CREATE');
      expect(auditRow!.entity_type).toBe('message');
    });

    it('stores assistant message with metadata', async () => {
      const conv = await models.createConversation('2024-04000', {});
      const content = 'Confirmado: acuerdo de $1.8M en 5 cuotas registrado.';
      const metadata = {
        response_type: 'confirmation' as const,
        processing_ok: true,
      };

      const msg = await models.createMessage(conv.id, 'assistant', content, metadata);

      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe(content);
      expect(msg.metadata.response_type).toBe('confirmation');
      expect(msg.metadata.processing_ok).toBe(true);

      // Row shows role='assistant'
      const row = db
        .prepare('SELECT * FROM messages WHERE id = ?')
        .get(msg.id) as { role: string } | undefined;
      expect(row!.role).toBe('assistant');
    });

    it('returns all messages in chronological order', async () => {
      const conv = await models.createConversation('2024-05000', {});

      const m1 = await models.createMessage(conv.id, 'user', 'Primer mensaje');
      const m2 = await models.createMessage(conv.id, 'assistant', 'Primera respuesta');
      const m3 = await models.createMessage(conv.id, 'user', 'Segundo mensaje');

      const history = await models.getConversationHistory(conv.id);

      expect(history).toHaveLength(3);

      // Oldest first
      expect(history[0].id).toBe(m1.id);
      expect(history[1].id).toBe(m2.id);
      expect(history[2].id).toBe(m3.id);

      // Roles alternate correctly
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
      expect(history[2].role).toBe('user');

      // Timestamps are ascending
      expect(history[0].created_at.getTime()).toBeLessThanOrEqual(
        history[2].created_at.getTime()
      );
    });

    it('returns last N messages in chronological order', async () => {
      const conv = await models.createConversation('2024-06000', {});

      // Create 25 messages
      for (let i = 1; i <= 25; i++) {
        const role = i % 2 === 0 ? 'assistant' : ('user' as const);
        await models.createMessage(conv.id, role, `Mensaje ${i}`);
      }

      const recent = await models.getRecentMessages(conv.id, 10);

      // Returns exactly 10
      expect(recent).toHaveLength(10);

      // They are the last 10 (messages 16–25)
      expect(recent[0].content).toBe('Mensaje 16');
      expect(recent[9].content).toBe('Mensaje 25');

      // Chronological order (oldest first within the 10)
      for (let i = 0; i < recent.length - 1; i++) {
        expect(recent[i].created_at.getTime()).toBeLessThanOrEqual(
          recent[i + 1].created_at.getTime()
        );
      }
    });
  });

  // ─── Audit Log Operations ───────────────────────────────────────────────────

  describe('Audit Log Operations', () => {
    it('queries audit trail by entity_id — newest first', async () => {
      const conv = await models.createConversation('2024-07000', { demandado: 'Ana' });

      // Add two extra direct audit entries for the conversation
      await models.createAuditLogEntry(
        'conversation',
        conv.id,
        'UPDATE',
        'webhook_sistema',
        { 'metadata.tribunal': { before: null, after: 'Juzgado Norte' } },
        { trigger: 'system' }
      );
      await models.createAuditLogEntry(
        'conversation',
        conv.id,
        'UPDATE',
        'admin_user001',
        { 'metadata.acuerdo_monto': { before: null, after: 500000 } },
        { trigger: 'manual_user' }
      );

      // Add a message (which creates its own audit entry for a different entity_id)
      await models.createMessage(conv.id, 'user', 'Mensaje de prueba');

      const trail = await models.getAuditTrail(conv.id);

      // Minimum: 1 CREATE (from createConversation) + 2 direct UPDATEs = 3
      expect(trail.length).toBeGreaterThanOrEqual(3);

      // All entries belong to conv.id
      for (const entry of trail) {
        expect(entry.entity_id).toBe(conv.id);
      }

      // Newest first
      for (let i = 0; i < trail.length - 1; i++) {
        expect(trail[i].created_at.getTime()).toBeGreaterThanOrEqual(
          trail[i + 1].created_at.getTime()
        );
      }
    });

    it('returns complete audit trail for a case across conversation + messages', async () => {
      const causaId = '2024-08000';
      const conv = await models.createConversation(causaId, { demandado: 'Carlos' });

      await models.createMessage(conv.id, 'user', 'Primer mensaje del caso');
      await models.createMessage(conv.id, 'assistant', 'Respuesta del sistema');
      await models.updateConversationMetadata(conv.id, { acuerdo_monto: 750000 });

      const trail = await models.getAuditTrailForCase(causaId);

      // At minimum: conv CREATE + 2 message CREATEs + conv UPDATE = 4
      expect(trail.length).toBeGreaterThanOrEqual(4);

      // Contains both 'conversation' and 'message' entity types
      const entityTypes = new Set(trail.map((e) => e.entity_type));
      expect(entityTypes.has('conversation')).toBe(true);
      expect(entityTypes.has('message')).toBe(true);

      // Newest first
      for (let i = 0; i < trail.length - 1; i++) {
        expect(trail[i].created_at.getTime()).toBeGreaterThanOrEqual(
          trail[i + 1].created_at.getTime()
        );
      }

      // Non-existent causa returns empty array
      const empty = await models.getAuditTrailForCase('nonexistent-causa-xyz');
      expect(empty).toEqual([]);
    });
  });

  // ─── Edge Cases & Constraints ───────────────────────────────────────────────

  describe('Edge Cases & Constraints', () => {
    it('enforces foreign key constraint — cannot create message for nonexistent conversation', async () => {
      const fakeConversationId = '00000000-0000-0000-0000-000000000000';

      await expect(
        models.createMessage(fakeConversationId, 'user', 'Este mensaje no debería existir')
      ).rejects.toThrow('does not exist');
    });

    it('deserializes complex nested metadata correctly', async () => {
      const conv = await models.createConversation('2024-09000', {});
      const complexMetadata = {
        intent: 'acuerdo' as const,
        monto_extraido: 1800000,
        tokens_used: {
          input: 500,
          output: 250,
        },
      };

      const msg = await models.createMessage(
        conv.id,
        'assistant',
        'Respuesta con metadata compleja',
        complexMetadata
      );

      // Re-read from DB via getConversationHistory to exercise deserialization
      const history = await models.getConversationHistory(conv.id);
      expect(history).toHaveLength(1);

      const retrieved = history[0];
      // Nested object must be deserialized, not stringified
      expect(typeof retrieved.metadata).toBe('object');
      expect(retrieved.metadata.monto_extraido).toBe(1800000);
      expect(retrieved.metadata.tokens_used).toEqual({ input: 500, output: 250 });
      expect(retrieved.metadata.tokens_used!.input).toBe(500);
      expect(retrieved.metadata.tokens_used!.output).toBe(250);
    });

    it('createAuditLogEntry — direct append persists and returns correct shape', async () => {
      const conv = await models.createConversation('2024-10000', {});

      const entry = await models.createAuditLogEntry(
        'conversation',
        conv.id,
        'UPDATE',
        'admin_user999',
        {
          'metadata.etapa': { before: 'litigacion', after: 'cobranza' },
        },
        { trigger: 'manual_user', notes: 'Cambio de etapa manual' }
      );

      expect(entry.id).toBeTruthy();
      expect(entry.entity_type).toBe('conversation');
      expect(entry.entity_id).toBe(conv.id);
      expect(entry.action).toBe('UPDATE');
      expect(entry.user_id).toBe('admin_user999');
      expect(entry.changes['metadata.etapa'].before).toBe('litigacion');
      expect(entry.changes['metadata.etapa'].after).toBe('cobranza');
      expect(entry.metadata.trigger).toBe('manual_user');
      expect(entry.metadata.notes).toBe('Cambio de etapa manual');
      expect(entry.created_at).toBeInstanceOf(Date);

      // Verify the row is in the DB
      const row = db
        .prepare('SELECT * FROM audit_log WHERE id = ?')
        .get(entry.id);
      expect(row).toBeDefined();
    });

    it('throws for updateConversationMetadata on nonexistent conversation', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';
      await expect(
        models.updateConversationMetadata(fakeId, { acuerdo_monto: 999 })
      ).rejects.toThrow('not found');
    });

    it('throws for closeConversation on nonexistent conversation', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000088';
      await expect(
        models.closeConversation(fakeId, 'admin_user')
      ).rejects.toThrow('not found');
    });

    it('getRecentMessages respects default limit of 20', async () => {
      const conv = await models.createConversation('2024-11000', {});

      // Create 30 messages
      for (let i = 1; i <= 30; i++) {
        const role = i % 2 === 0 ? 'assistant' : ('user' as const);
        await models.createMessage(conv.id, role, `Mensaje ${i}`);
      }

      // Default limit = 20
      const recent = await models.getRecentMessages(conv.id);
      expect(recent).toHaveLength(20);

      // Last 20 messages: 11–30
      expect(recent[0].content).toBe('Mensaje 11');
      expect(recent[19].content).toBe('Mensaje 30');
    });

    it('getConversationHistory returns empty array for conversation with no messages', async () => {
      const conv = await models.createConversation('2024-12000', {});
      const history = await models.getConversationHistory(conv.id);
      expect(history).toEqual([]);
    });

    it('webhook data fields not in schema are silently ignored in metadata', async () => {
      const causaId = '2024-13000';
      const conv = await models.createConversation(causaId, {
        demandado: 'Rodrigo',
        monto_demanda: 500000,
        unknown_field: 'should be ignored',
        another_field: 12345,
      });

      // Known fields are stored
      expect(conv.metadata.demandado).toBe('Rodrigo');
      expect(conv.metadata.monto_demanda).toBe(500000);

      // Unknown fields are not present in metadata (models.ts filters explicitly)
      expect((conv.metadata as Record<string, unknown>)['unknown_field']).toBeUndefined();
    });
  });
});
