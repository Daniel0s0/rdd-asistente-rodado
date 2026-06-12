/**
 * models.test.ts — RDD Database CRUD Integration Tests (Supabase)
 *
 * Strategy:
 *   - Mock getDb() from @database/supabase
 *   - Tests create actual Supabase-compatible responses
 *   - Verify that model functions handle async operations correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock env BEFORE importing models ───────────────────────────────────────────
vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    PORT: 3001,
    LOG_LEVEL: 'info',
    SAAS_WEBHOOK_SECRET: 'test_secret',
    SAAS_API_URL: 'http://localhost:3000',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    CLAUDE_MODEL: 'claude-3-5-sonnet-20241022',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: 'test-key',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'test-sheet-id',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'test-folder-id',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    CLAUDE_MAX_CONTEXT_TURNS: 10,
    CLAUDE_TEMPERATURE: 0.3,
    GOOGLE_API_TIMEOUT: 30000,
    GOOGLE_API_MAX_RETRIES: 3,
    UI_API_KEY: 'test_api_key_min_32_chars_long_enough',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEBHOOK_RATE_LIMIT: 100,
    CHAT_RATE_LIMIT: 30,
    ENABLE_AUDIT_LOGGING: true,
    ENABLE_DETAILED_LOGGING: false,
  }),
}));

// ─── Mock getDb (Supabase) BEFORE importing models ───────────────────────────
vi.mock('@database/supabase', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

// Now import models (they will use the mocked getDb).
import * as models from '@database/models';
import { getDb } from '@database/supabase';
import { Conversation, Message, AuditLogEntry } from '@database/schema';

// ─── Stateful In-Memory Database for Tests ────────────────────────────────────

class TestDatabase {
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message[]> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private callCount = 0;

  // Simulate Supabase insert behavior
  insertConversation(conv: Conversation): Promise<{ data: Conversation; error: null }> {
    this.conversations.set(conv.id, conv);
    return Promise.resolve({ data: conv, error: null });
  }

  // Simulate Supabase query behavior
  queryConversationByCausaId(causaId: string): Promise<{ data: Conversation | null; error: null }> {
    for (const conv of this.conversations.values()) {
      if (conv.causa_id === causaId) {
        return Promise.resolve({ data: conv, error: null });
      }
    }
    return Promise.resolve({
      data: null,
      error: null, // Supabase returns null for single() with no results, code: PGRST116
    });
  }

  updateConversation(id: string, updates: Partial<Conversation>): Promise<{ data: Conversation; error: null }> {
    const conv = this.conversations.get(id);
    if (!conv) {
      return Promise.reject({ message: `Conversation not found` });
    }
    const updated = { ...conv, ...updates };
    this.conversations.set(id, updated);
    return Promise.resolve({ data: updated, error: null });
  }

  getAllConversations(): Promise<{ data: Conversation[]; error: null }> {
    return Promise.resolve({ data: Array.from(this.conversations.values()), error: null });
  }

  insertMessage(msg: Message): Promise<{ data: Message; error: null }> {
    const convMessages = this.messages.get(msg.conversation_id) || [];
    convMessages.push(msg);
    this.messages.set(msg.conversation_id, convMessages);
    return Promise.resolve({ data: msg, error: null });
  }

  getConversationMessages(conversationId: string): Promise<{ data: Message[]; error: null }> {
    const msgs = this.messages.get(conversationId) || [];
    return Promise.resolve({ data: msgs, error: null });
  }

  insertAuditLogEntry(entry: AuditLogEntry): Promise<{ data: AuditLogEntry; error: null }> {
    this.auditLog.push(entry);
    return Promise.resolve({ data: entry, error: null });
  }

  getAuditTrail(entityId: string): Promise<{ data: AuditLogEntry[]; error: null }> {
    const entries = this.auditLog.filter((e) => e.entity_id === entityId);
    return Promise.resolve({ data: entries, error: null });
  }

  reset() {
    this.conversations.clear();
    this.messages.clear();
    this.auditLog = [];
    this.callCount = 0;
  }

  trackCall(table: string) {
    this.callCount++;
    return this.callCount;
  }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Database CRUD Operations', () => {
  let db: TestDatabase;
  let mockSupabaseClient: any;

  beforeEach(() => {
    db = new TestDatabase();

    // Create a mock Supabase client that delegates to our in-memory database
    mockSupabaseClient = {
      from: vi.fn((table: string) => {
        db.trackCall(table);

        if (table === 'conversations') {
          // Create conversation query chain with filter tracking
          const query: any = {
            insert: vi.fn((data: any) => ({
              select: vi.fn().mockReturnThis(),
              single: vi.fn(() => db.insertConversation(data[0])),
              then: (onFulfilled: any) =>
                db.insertConversation(data[0]).then(onFulfilled),
              catch: vi.fn(),
            })),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string, val: any) => {
              query._lastEqCol = col;
              query._lastEqVal = val;
              return query; // Return self for chaining
            }),
            is: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((col: string, val: any) => ({
                select: vi.fn().mockReturnThis(),
                single: vi.fn(() => db.updateConversation(val, updates)),
                then: (onFulfilled: any) => db.updateConversation(val, updates).then(onFulfilled),
                catch: vi.fn(),
              })),
              then: (onFulfilled: any) => Promise.resolve(null).then(onFulfilled),
              catch: vi.fn(),
            })),
            then: (onFulfilled: any) => db.getAllConversations().then(onFulfilled),
            single: vi.fn(() => {
              if (query._lastEqCol === 'causa_id') {
                return db.queryConversationByCausaId(query._lastEqVal);
              }
              return Promise.resolve({ data: null, error: null });
            }),
            catch: vi.fn(),
            _lastEqCol: '',
            _lastEqVal: '',
          };

          return query;
        } else if (table === 'messages') {
          return {
            insert: vi.fn((data: any) => ({
              select: vi.fn().mockReturnThis(),
              single: vi.fn(() => db.insertMessage(data[0])),
              then: (onFulfilled: any) => db.insertMessage(data[0]).then(onFulfilled),
              catch: vi.fn(),
            })),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string, val: any) => {
              const chainResult = {
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                then: (onFulfilled: any) => {
                  if (col === 'conversation_id') {
                    return db.getConversationMessages(val).then(onFulfilled);
                  }
                  return Promise.resolve([]).then(onFulfilled);
                },
                catch: vi.fn(),
              };
              return chainResult;
            }),
            order: vi.fn().mockReturnThis(),
            then: (onFulfilled: any) => db.getConversationMessages('').then(onFulfilled),
            catch: vi.fn(),
          };
        } else if (table === 'audit_log') {
          return {
            insert: vi.fn((data: any) => ({
              select: vi.fn().mockReturnThis(),
              single: vi.fn(() => db.insertAuditLogEntry(data[0])),
              then: (onFulfilled: any) =>
                db.insertAuditLogEntry(data[0]).then(onFulfilled),
              catch: vi.fn(),
            })),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string, val: any) => ({
              order: vi.fn().mockReturnThis(),
              then: (onFulfilled: any) => {
                if (col === 'entity_id') {
                  return db.getAuditTrail(val).then(onFulfilled);
                }
                return Promise.resolve([]).then(onFulfilled);
              },
              catch: vi.fn(),
            })),
            order: vi.fn().mockReturnThis(),
            then: (onFulfilled: any) => Promise.resolve([]).then(onFulfilled),
            catch: vi.fn(),
          };
        }

        return {
          insert: vi.fn(),
          select: vi.fn(),
          then: vi.fn(),
          catch: vi.fn(),
        };
      }),
    };

    vi.mocked(getDb).mockReturnValue(mockSupabaseClient);
  });

  // ─── Conversation CRUD ──────────────────────────────────────────────────────

  describe('Conversation CRUD', () => {
    it('creates conversation with webhook data', async () => {
      const causaId = '2024-00123';
      const webhookData = {
        cliente_nombre: 'García López',
        cliente_rut: '12.345.678-9',
        demandado: 'Acme Corp',
        tribunal: 'Laboral de Santiago',
        rit: '24-00123-4',
      };

      const result = await models.createConversation(causaId, webhookData);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(result.causa_id).toBe(causaId);
      expect(result.cliente_nombre).toBe('García López');
    });

    it('finds conversation by causa_id', async () => {
      const causaId = '2024-00789';
      const webhookData = {
        cliente_nombre: 'María López',
        cliente_rut: '98.765.432-1',
        demandado: 'Otro Corp',
        tribunal: 'Juzgado Civil',
        rit: '24-00789-1',
      };

      const created = await models.createConversation(causaId, webhookData);

      const result = await models.getConversationByCausaId(causaId);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(result?.causa_id).toBe(causaId);
    });

    it('returns null for non-existent causa_id', async () => {
      const result = await models.getConversationByCausaId('nonexistent-causa-xyz');

      expect(result).toBeNull();
    });

    it('updates conversation metadata', async () => {
      const causaId = '2024-00123-upd';
      const webhookData = {
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Test Corp',
        tribunal: 'Test Court',
        rit: '24-00123-1',
      };

      const created = await models.createConversation(causaId, webhookData);
      const conversationId = created.id;

      const updates = { acuerdo_monto: 1800000, acuerdo_cuotas: 5 };
      const result = await models.updateConversationMetadata(conversationId, updates);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(result.acuerdo_monto).toBe(1800000);
    });

    it('closes conversation', async () => {
      const causaId = '2024-00789-close';
      const webhookData = {
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Test Corp',
        tribunal: 'Test Court',
        rit: '24-00789-1',
      };

      const created = await models.createConversation(causaId, webhookData);
      const conversationId = created.id;

      const result = await models.closeConversation(conversationId, 'admin_user');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(result.closed_at).not.toBeNull();
    });

    it('createSimpleConversation creates conversation without case data', async () => {
      const result = await models.createSimpleConversation('__portfolio__');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(result.causa_id).toBe('__portfolio__');
      expect(result.case_state).toBe('activa');
      // Verify that case-specific fields are undefined/null
      expect(result.cliente_nombre).toBeUndefined();
      expect(result.demandado).toBeUndefined();
    });

    it('createSimpleConversation inserts minimal row with no case-specific fields', async () => {
      // Verify structure: should only have id, causa_id, and basic fields
      const result = await models.createSimpleConversation('__portfolio__');

      // Check that the minimal structure is correct
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('causa_id', '__portfolio__');
      expect(result).toHaveProperty('case_state', 'activa');
      expect(result).toHaveProperty('message_count', 0);

      // Verify no case-specific fields
      expect(result.cliente_nombre).toBeUndefined();
      expect(result.demandado).toBeUndefined();
      expect(result.tribunal).toBeUndefined();
      expect(result.rit).toBeUndefined();
    });
  });

  // ─── Message CRUD ──────────────────────────────────────────────────────────

  describe('Message CRUD', () => {
    it('stores user message with metadata', async () => {
      const causaId = 'TEST-msg-' + Date.now();
      const webhookData = {
        cliente_nombre: 'Test Client',
        cliente_rut: '12.345.678-9',
        demandado: 'Test Defendant',
        tribunal: 'Test Court',
        rit: '24-00001-1',
      };

      const conv = await models.createConversation(causaId, webhookData);
      const conversationId = conv.id;
      const messageText = 'Acuerdo de $500k en 5 cuotas';

      const result = await models.createMessage(conversationId, 'user', messageText, {
        intent: 'agreement',
        monto: 500000,
        cuotas: 5,
      });

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('messages');
      expect(result.role).toBe('user');
    });

    it('stores assistant message with metadata', async () => {
      const causaId = 'TEST-asst-' + Date.now();
      const webhookData = {
        cliente_nombre: 'Test Client',
        cliente_rut: '12.345.678-9',
        demandado: 'Test Defendant',
        tribunal: 'Test Court',
        rit: '24-00002-1',
      };

      const conv = await models.createConversation(causaId, webhookData);
      const conversationId = conv.id;
      const messageText = '✅ Registrado: Acuerdo de $500,000 en 5 cuotas';

      const result = await models.createMessage(conversationId, 'assistant', messageText, {
        model: 'claude-3-5-sonnet-20241022',
        tokens_used: 250,
      });

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('messages');
      expect(result.role).toBe('assistant');
    });

    it('returns recent messages', async () => {
      const causaId = 'TEST-recent-' + Date.now();
      const webhookData = {
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Corp',
        tribunal: 'Court',
        rit: '24-00003-1',
      };

      const conv = await models.createConversation(causaId, webhookData);
      const conversationId = conv.id;

      await models.createMessage(conversationId, 'user', 'Hola', {});
      await models.createMessage(conversationId, 'assistant', 'Hola!', {});

      const result = await models.getRecentMessages(conversationId, 20);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('messages');
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('returns conversation history', async () => {
      const causaId = 'TEST-hist-' + Date.now();
      const webhookData = {
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Corp',
        tribunal: 'Court',
        rit: '24-00004-1',
      };

      const conv = await models.createConversation(causaId, webhookData);
      const conversationId = conv.id;

      await models.createMessage(conversationId, 'user', 'Mensaje 1', {});

      const result = await models.getConversationHistory(conversationId);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('messages');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── List with Search & Filters ──────────────────────────────────────────────

  describe('List Conversations with Search & Filters', () => {
    it('lists conversations with search query', async () => {
      await models.createConversation('SEARCH-1', {
        cliente_nombre: 'García López',
        cliente_rut: '12.345.678-9',
        demandado: 'Acme',
        tribunal: 'Laboral',
        rit: '24-00001-1',
      });

      const result = await models.listConversations({ q: 'García', limit: 10, offset: 0 });

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(Array.isArray(result)).toBe(true);
    });

    it('lists conversations filtered by case_state', async () => {
      await models.createConversation('STATE-1', {
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Corp',
        tribunal: 'Court',
        rit: '24-00005-1',
      });

      const result = await models.listConversations({ case_state: 'activa', limit: 10, offset: 0 });

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(Array.isArray(result)).toBe(true);
    });

    it('lists conversations filtered by tribunal', async () => {
      await models.createConversation('TRIB-1', {
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Corp',
        tribunal: 'Laboral de Santiago',
        rit: '24-00006-1',
      });

      const result = await models.listConversations({ tribunal: 'Laboral de Santiago', limit: 10, offset: 0 });

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('conversations');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── Audit Log ────────────────────────────────────────────────────────────────

  describe('Audit Log Operations', () => {
    it('creates audit log entry', async () => {
      const result = await models.createAuditLogEntry(
        'conversation',
        'conv-123',
        'CREATE',
        'admin_user',
        { causa_id: { before: null, after: '2024-00123' } }
      );

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('audit_log');
      expect(result.action).toBe('CREATE');
      expect(result.entity_type).toBe('conversation');
    });

    it('returns audit trail for entity', async () => {
      await models.createAuditLogEntry(
        'conversation',
        'conv-123',
        'CREATE',
        'admin',
        {}
      );

      const result = await models.getAuditTrail('conv-123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('audit_log');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });
});
